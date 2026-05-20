import type { NonEmptyArray } from "@aikirun/lib/array";
import { chunkLazy, isNonEmptyArray } from "@aikirun/lib/array";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerSortedSet } from "@aikirun/types/infra/timer";
import type { WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow/run";
import type { WorkflowRunMeta } from "server/infra/db/pg/repository/workflow-run";
import type {
	Repositories,
	StateTransitionRowInsert,
	WorkflowRow,
	WorkflowRunOutboxRowInsert,
} from "server/infra/db/types";
import { runConcurrently } from "server/lib/concurrency";
import type { Ranked } from "server/lib/rank";
import type { DaemonContext } from "server/middleware/context";
import { discardStaleTasks } from "server/service/discard-stale-tasks";
import { ulid } from "ulidx";

import { streamTimers } from "./lib/timer-stream";
import { publishRuns } from "./publish-ready-runs";

type Repos = Pick<
	Repositories,
	"workflowRun" | "stateTransition" | "task" | "workflow" | "workflowRunOutbox" | "transaction"
>;

export interface ProcessImminentRetryableRunsDeps {
	repos: Repos;
	workflowRunPublisher?: Publisher;
	timerSortedSet?: TimerSortedSet;
}

export async function processImminentRetryableRuns(
	context: DaemonContext,
	{ repos, workflowRunPublisher, timerSortedSet }: ProcessImminentRetryableRunsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 1_000, imminenceThresholdMs = 3_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);

	for await (const { dueNow: runsDueNow, dueSoon: runsDueSoon } of streamTimers(
		(cursor) => repos.workflowRun.listRetryableRuns(context, dueBefore, limit, cursor),
		{ until: (chunk) => chunk.length < limit }
	)) {
		if (isNonEmptyArray(runsDueNow)) {
			await queueRetryableRuns(context, repos, workflowRunPublisher, runsDueNow);
		}

		if (timerSortedSet && isNonEmptyArray(runsDueSoon)) {
			const timers: TimerEntry[] = runsDueSoon.map((run) => ({
				type: "retry",
				id: run.id,
				dueAt: run.dueAt.getTime(),
				rank: run.rank,
			}));
			if (isNonEmptyArray(timers)) {
				await timerSortedSet.add(timers);
			}
		}
	}
}

export async function queueRetryableRuns(
	context: DaemonContext,
	repos: Repos,
	workflowRunPublisher: Publisher | undefined,
	runs: NonEmptyArray<Ranked<WorkflowRunMeta>>,
	options?: { chunkSize?: number }
) {
	const { chunkSize = runs.length } = options ?? {};

	const workflowIds = Array.from(new Set(runs.map((run) => run.workflowId)));
	if (!isNonEmptyArray(workflowIds)) {
		return;
	}
	const workflows = await repos.workflow.getByIdsGlobal(context, workflowIds);
	const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

	await runConcurrently(context, chunkLazy(runs, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, repos, workflowRunPublisher, chunk, workflowsById);
		} catch (error) {
			spanCtx.logger.warn("Failed to process chunk, will retry next tick", { error, chunkSize: chunk.length });
		}
	});
}

async function processChunk(
	context: DaemonContext,
	repos: Repos,
	workflowRunPublisher: Publisher | undefined,
	runs: NonEmptyArray<Ranked<WorkflowRunMeta>>,
	workflowsById: Map<string, WorkflowRow>
): Promise<void> {
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: Array<{ filter: { id: string; revision: number }; update: { stateTransitionId: string } }> =
		[];
	const outboxEntries: WorkflowRunOutboxRowInsert[] = [];

	for (const run of runs) {
		const workflow = workflowsById.get(run.workflowId);
		if (!workflow) {
			continue;
		}

		const stateTransitionId = ulid();
		const state: WorkflowRunStateQueued = { status: "queued", reason: "retry" };
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "queued",
			attempt: run.attempts + 1,
			state,
		});
		workflowRunUpdates.push({
			filter: {
				id: run.id,
				revision: run.revision,
			},
			update: {
				stateTransitionId,
			},
		});

		outboxEntries.push({
			id: ulid(),
			namespaceId: run.namespaceId,
			workflowRunId: run.id,
			workflowName: workflow.name,
			workflowVersionId: workflow.versionId,
			shard: (run.options as WorkflowStartOptions | null)?.shard,
			status: "pending",
			rank: run.rank,
		});
	}

	if (!isNonEmptyArray(stateTransitionEntries) || !isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await repos.transaction(async (txRepos) => {
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued("awaiting_retry", workflowRunUpdates, {
			incrementAttempts: true,
		});
		if (!isNonEmptyArray(transitionedRunIds)) {
			return [];
		}

		await discardStaleTasks(transitionedRunIds, txRepos);

		const transitionedRunIdsSet = new Set(transitionedRunIds);
		const outboxEntriesToInsert = outboxEntries.filter((entry) => transitionedRunIdsSet.has(entry.workflowRunId));
		if (!isNonEmptyArray(outboxEntriesToInsert)) {
			return [];
		}
		await txRepos.workflowRunOutbox.createBatch(outboxEntriesToInsert);
		return outboxEntriesToInsert;
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishRuns(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}
