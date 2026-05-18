import type { NonEmptyArray } from "@aikirun/lib/array";
import { chunkLazy, isNonEmptyArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";
import type { Publisher } from "@aikirun/types/publisher";
import type { TimerEntry, TimerSortedSet } from "@aikirun/types/timer";
import type { WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow-run";
import type { WorkflowRunMeta } from "server/infra/db/pg/repository/workflow-run";
import type {
	Repositories,
	StateTransitionRowInsert,
	WorkflowRow,
	WorkflowRunOutboxRowInsert,
} from "server/infra/db/types";
import { runConcurrently } from "server/lib/concurrency";
import { computeRank, type Ranked } from "server/lib/rank";
import type { DaemonContext } from "server/middleware/context";
import { ulid } from "ulidx";

import { createTimerStreamCursorAdvancer } from "./lib/timer-stream";
import { publishRuns } from "./publish-ready-runs";

type Repos = Pick<
	Repositories,
	"task" | "workflowRun" | "stateTransition" | "workflow" | "workflowRunOutbox" | "transaction"
>;

export interface ProcessImminentRetryableTaskRunsDeps {
	repos: Repos;
	workflowRunPublisher?: Publisher;
	timerSortedSet?: TimerSortedSet;
}

const advanceTaskCursor = createTimerStreamCursorAdvancer<{ workflowRunId: string; dueAt: Date }>({
	getDueAt: (entry) => entry.dueAt,
	getId: (entry) => entry.workflowRunId,
});

export async function processImminentRetryableTaskRuns(
	context: DaemonContext,
	{ repos, workflowRunPublisher, timerSortedSet }: ProcessImminentRetryableTaskRunsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 1_000, imminenceThresholdMs = 3_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);

	let now = Date.now();
	for await (const { whenTrue: tasksDueNow, whenFalse: tasksDueSoon } of streamChunks(
		(cursor) => repos.task.listRetryableTaskWorkflowRuns(context, dueBefore, limit, cursor),
		{
			advanceCursor: advanceTaskCursor,
			until: (chunk) => chunk.length < limit,
			partition: (task: { workflowRunId: string; dueAt: Date }) => ({
				meetsCondition: task.dueAt.getTime() <= now,
				item: task,
			}),
		}
	)) {
		if (isNonEmptyArray(tasksDueNow)) {
			const runIds: string[] = [];
			const rankByRunId = new Map<string, number>();
			for (const { workflowRunId, dueAt } of tasksDueNow) {
				runIds.push(workflowRunId);
				rankByRunId.set(workflowRunId, computeRank(dueAt.getTime()));
			}

			const runs = await repos.workflowRun.listByIdsAndStatus(context, runIds as NonEmptyArray<string>, "running");
			const rankedRuns: Ranked<WorkflowRunMeta>[] = [];
			for (const run of runs) {
				const rank = rankByRunId.get(run.id);
				if (rank !== undefined) {
					rankedRuns.push({ ...run, rank });
				}
			}
			if (isNonEmptyArray(rankedRuns)) {
				await queueRetryableTaskRuns(context, repos, workflowRunPublisher, rankedRuns);
			}
		}

		if (timerSortedSet && isNonEmptyArray(tasksDueSoon)) {
			const timers: TimerEntry[] = tasksDueSoon.map((task) => ({
				type: "task_retry",
				id: task.workflowRunId,
				dueAt: task.dueAt.getTime(),
				rank: computeRank(task.dueAt.getTime()),
			}));
			if (isNonEmptyArray(timers)) {
				await timerSortedSet.add(timers);
			}
		}

		now = Date.now();
	}
}

export async function queueRetryableTaskRuns(
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
			spanCtx.logger.warn({ error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
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
		const state: WorkflowRunStateQueued = { status: "queued", reason: "task_retry" };
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

	if (!isNonEmptyArray(stateTransitionEntries) || !isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await repos.transaction(async (txRepos) => {
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued("running", workflowRunUpdates);
		const transitionedRunIdsSet = new Set(transitionedRunIds);
		const outboxEntriesToInsert = outboxEntries.filter((entry) => transitionedRunIdsSet.has(entry.workflowRunId));
		if (!isNonEmptyArray(outboxEntriesToInsert)) {
			return [];
		}
		const workflowRunIds = outboxEntriesToInsert.map((entry) => entry.workflowRunId) as NonEmptyArray<string>;
		// Outbox entries are only deleted on workflow suspension or termination.
		// In our case, the workflow is still running, hence the outbox entry is still in claimed state.
		// It needs to be deleted to avoid conflict.
		// Upsert is another option, but one needs think carefully about which columns get updated.
		await txRepos.workflowRunOutbox.deleteByWorkflowRunIds(context, workflowRunIds);
		await txRepos.workflowRunOutbox.createBatch(outboxEntriesToInsert);
		return outboxEntriesToInsert;
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishRuns(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}
