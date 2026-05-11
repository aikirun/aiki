import type { NonEmptyArray } from "@aikirun/lib/array";
import { chunkLazy, isNonEmptyArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";
import type { WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow-run";
import type { WorkflowRunMeta } from "server/infra/db/pg/repository/workflow-run";
import type {
	Repositories,
	StateTransitionRowInsert,
	WorkflowRow,
	WorkflowRunOutboxRowInsert,
} from "server/infra/db/types";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { TimerEntry, TimerSortedSet } from "server/infra/messaging/redis-timer-sorted-set";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

import { createTimerStreamCursorAdvancer } from "./lib/timer-stream";
import { publishRuns } from "./publish-ready-runs";

type Repos = Pick<
	Repositories,
	"task" | "workflowRun" | "stateTransition" | "workflow" | "workflowRunOutbox" | "transaction"
>;

export interface ProcessImminentRetryableTaskRunsDeps {
	repos: Repos;
	workflowRunPublisher?: WorkflowRunPublisher;
	timerSortedSet?: TimerSortedSet;
}

const advanceTaskCursor = createTimerStreamCursorAdvancer<{ workflowRunId: string; dueAt: Date }>({
	getDueAt: (entry) => entry.dueAt,
	getId: (entry) => entry.workflowRunId,
});

export async function processImminentRetryableTaskRuns(
	context: CronContext,
	{ repos, workflowRunPublisher, timerSortedSet }: ProcessImminentRetryableTaskRunsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 1_000, imminenceThresholdMs = 5_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);

	let now = Date.now();
	for await (const { whenTrue: tasksDueNow, whenFalse: tasksDueSoon } of streamChunks(
		(cursor) => repos.task.listRetryableTaskWorkflowRuns(context, dueBefore, limit, cursor),
		{
			advanceCursor: advanceTaskCursor,
			until: (chunk) => chunk.length < limit,
			partition: (task: { dueAt: Date }) => task.dueAt.getTime() <= now,
		}
	)) {
		if (isNonEmptyArray(tasksDueNow)) {
			const runIds = tasksDueNow.map((task) => task.workflowRunId) as NonEmptyArray<string>;
			const runs = await repos.workflowRun.listByIdsAndStatus(context, runIds, "running");
			if (isNonEmptyArray(runs)) {
				await queueRetryableTaskRuns(context, repos, workflowRunPublisher, runs);
			}
		}

		if (timerSortedSet && isNonEmptyArray(tasksDueSoon)) {
			const timers: TimerEntry[] = tasksDueSoon.map((task) => ({
				type: "task_retry",
				id: task.workflowRunId,
				dueAt: task.dueAt.getTime(),
			}));
			if (isNonEmptyArray(timers)) {
				await timerSortedSet.add(timers);
			}
		}

		now = Date.now();
	}
}

export async function queueRetryableTaskRuns(
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<WorkflowRunMeta>,
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
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<WorkflowRunMeta>,
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
		await txRepos.workflowRunOutbox.createBatch(outboxEntriesToInsert);
		return outboxEntriesToInsert;
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishRuns(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}
