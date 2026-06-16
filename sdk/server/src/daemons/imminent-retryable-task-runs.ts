import { streamChunks } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { chunkLazy, isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";
import type { WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { publishPendingOutboxEntries } from "./publish-ready-runs";
import type { Repositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRow } from "../infra/db/types/workflow";
import type { WorkflowRunMeta } from "../infra/db/types/workflow-run";
import type { WorkflowRunOutboxRowInsertPending } from "../infra/db/types/workflow-run-outbox";
import { runConcurrently } from "../lib/concurrency";
import { computeRank, type Ranked } from "../lib/rank";
import { createTimerStreamCursorAdvancer } from "../lib/timer-stream";
import type { DaemonContext } from "../middleware/context";

type Repos = Pick<
	Repositories,
	"task" | "workflowRun" | "stateTransition" | "workflow" | "workflowRunOutbox" | "transaction"
>;

export interface ProcessImminentRetryableTaskRunsDeps {
	repos: Repos;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
}

const advanceTaskCursor = createTimerStreamCursorAdvancer<{ workflowRunId: string; dueAt: TimestampMs }>({
	getDueAt: (entry) => entry.dueAt,
	getId: (entry) => entry.workflowRunId,
});

export async function processImminentRetryableTaskRuns(
	context: DaemonContext,
	{ repos, workflowRunPublisher, timerPriorityQueue }: ProcessImminentRetryableTaskRunsDeps,
	{ limit, imminenceThresholdMs }: { limit: number; imminenceThresholdMs: number }
) {
	const dueBefore = (Date.now() + imminenceThresholdMs) as TimestampMs;

	let now = Date.now();
	for await (const { whenTrue: tasksDueNow, whenFalse: tasksDueSoon } of streamChunks(
		(cursor) => repos.task.listRetryableTasks(context, dueBefore, limit, cursor),
		{
			advanceCursor: advanceTaskCursor,
			until: (chunk) => chunk.length < limit,
			partition: (task: { workflowRunId: string; dueAt: TimestampMs }) => ({
				meetsCondition: task.dueAt <= now,
				item: task,
			}),
		}
	)) {
		if (isNonEmptyArray(tasksDueNow)) {
			const runIds: string[] = [];
			const rankByRunId = new Map<string, number>();
			for (const { workflowRunId, dueAt } of tasksDueNow) {
				runIds.push(workflowRunId);
				rankByRunId.set(workflowRunId, computeRank(dueAt));
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

		if (timerPriorityQueue && isNonEmptyArray(tasksDueSoon)) {
			const timers: TimerEntry[] = tasksDueSoon.map((task) => ({
				type: "task_retry",
				id: task.workflowRunId,
				dueAt: task.dueAt,
				rank: computeRank(task.dueAt),
			}));
			const result = await timerPriorityQueue.add(timers as NonEmptyArray<TimerEntry>);
			if (result.status === "failed") {
				context.logger.debug("Failed to add timers to priority queue", { count: timers.length });
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

	const workflowIds = Array.from(new Set(runs.map((run) => run.workflowId))) as NonEmptyArray<string>;
	const workflows = await repos.workflow.getByIdsGlobal(context, workflowIds);
	const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

	await runConcurrently(context, chunkLazy(runs, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, repos, workflowRunPublisher, chunk, workflowsById);
		} catch (err) {
			spanCtx.logger.warn("Failed to process chunk, will retry next tick", { err, chunkSize: chunk.length });
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
	const outboxEntries: WorkflowRunOutboxRowInsertPending[] = [];

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

	if (!isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsertPending[] = await repos.transaction(async (txRepos) => {
		const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued("running", workflowRunUpdates);
		if (!isNonEmptyArray(transitionedRunIds)) {
			return [];
		}

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
		await publishPendingOutboxEntries(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}
