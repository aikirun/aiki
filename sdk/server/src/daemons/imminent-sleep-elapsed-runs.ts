import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";
import type { WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { publishRuns } from "./publish-ready-runs";
import type { Repositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRow } from "../infra/db/types/workflow";
import type { WorkflowRunMeta } from "../infra/db/types/workflow-run";
import type { WorkflowRunOutboxRowInsert } from "../infra/db/types/workflow-run-outbox";
import { runConcurrently } from "../lib/concurrency";
import type { Ranked } from "../lib/rank";
import { streamTimers } from "../lib/timer-stream";
import type { DaemonContext } from "../middleware/context";

type Repos = Pick<
	Repositories,
	"workflowRun" | "stateTransition" | "sleepQueue" | "workflow" | "workflowRunOutbox" | "transaction"
>;

export interface ProcessImminentSleepElapsedRunsDeps {
	repos: Repos;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
}

export async function processImminentSleepElapsedRuns(
	context: DaemonContext,
	{ repos, workflowRunPublisher, timerPriorityQueue }: ProcessImminentSleepElapsedRunsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 1_000, imminenceThresholdMs = 3_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);

	for await (const { dueNow: runsDueNow, dueSoon: runsDueSoon } of streamTimers(
		(cursor) => repos.workflowRun.listSleepElapsedRuns(context, dueBefore, limit, cursor),
		{ until: (chunk) => chunk.length < limit }
	)) {
		if (isNonEmptyArray(runsDueNow)) {
			await queueSleepElapsedRuns(context, repos, workflowRunPublisher, runsDueNow);
		}

		if (timerPriorityQueue && isNonEmptyArray(runsDueSoon)) {
			const timers: TimerEntry[] = runsDueSoon.map((run) => ({
				type: "sleep",
				id: run.id,
				dueAt: run.dueAt.getTime(),
				rank: run.rank,
			}));
			await timerPriorityQueue.add(timers as NonEmptyArray<TimerEntry>);
		}
	}
}

export async function queueSleepElapsedRuns(
	context: DaemonContext,
	repos: Repos,
	workflowRunPublisher: Publisher | undefined,
	runs: NonEmptyArray<Ranked<WorkflowRunMeta>>,
	options?: { chunkSize?: number }
) {
	const { chunkSize = runs.length } = options ?? {};

	const workflowIds = Array.from(new Set(runs.map((run) => run.workflowId))) as NonEmptyArray<string>;
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
	const completedAt = new Date();

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
		const state: WorkflowRunStateQueued = { status: "queued", reason: "awake" };
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "queued",
			attempt: run.attempts,
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
			rank: run.rank,
			status: "pending",
		});
	}

	if (!isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await repos.transaction(async (txRepos) => {
		const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued("sleeping", workflowRunUpdates);
		if (!isNonEmptyArray(transitionedRunIds)) {
			return [];
		}

		await txRepos.sleepQueue.bulkCompleteByWorkflowRunIds(transitionedRunIds, completedAt);

		let stateTransitionEntriesToInsert = stateTransitionEntries;
		let outboxEntriesToInsert = outboxEntries;
		if (transitionedRunIds.length !== stateTransitionEntries.length) {
			const transitionedRunIdsSet = new Set(transitionedRunIds);
			stateTransitionEntriesToInsert = stateTransitionEntries.filter((entry) =>
				transitionedRunIdsSet.has(entry.workflowRunId)
			);
			outboxEntriesToInsert = outboxEntries.filter((entry) => transitionedRunIdsSet.has(entry.workflowRunId));
		}

		if (!isNonEmptyArray(stateTransitionEntriesToInsert) || !isNonEmptyArray(outboxEntriesToInsert)) {
			return [];
		}

		await txRepos.stateTransition.appendBatch(stateTransitionEntriesToInsert);
		await txRepos.workflowRunOutbox.createBatch(outboxEntriesToInsert);
		return outboxEntriesToInsert;
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishRuns(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}
