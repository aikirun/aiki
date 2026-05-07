import type { NonEmptyArray } from "@aikirun/lib/array";
import { chunkLazy, isNonEmptyArray, splitArray } from "@aikirun/lib/array";
import type { WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow-run";
import type {
	DueWorkflowRun,
	Repositories,
	StateTransitionRowInsert,
	WorkflowRow,
	WorkflowRunOutboxRowInsert,
} from "server/infra/db/types";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { TimerSortedSet } from "server/infra/messaging/redis-timer-sorted-set";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

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

export async function processImminentRetryableTaskRuns(
	context: CronContext,
	{ repos, workflowRunPublisher, timerSortedSet }: ProcessImminentRetryableTaskRunsDeps,
	options?: { limit?: number; chunkSize?: number; imminenceThresholdMs?: number }
) {
	const { limit = 100, chunkSize = 50, imminenceThresholdMs = 1_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);
	const retryableTasks = await repos.task.listRetryableTaskWorkflowRuns(context, dueBefore, limit);
	if (!isNonEmptyArray(retryableTasks)) {
		return;
	}

	const now = Date.now();
	const { whenTrue: tasksDueNow, whenFalse: tasksDueSoon } = splitArray(retryableTasks, (task) => {
		if (task.dueAt && new Date(task.dueAt).getTime() > now) {
			return { meetsCondition: false, item: task };
		}
		return { meetsCondition: true, item: task };
	});

	if (isNonEmptyArray(tasksDueNow)) {
		const workflowRunIds = tasksDueNow.map((task) => task.workflowRunId);
		if (isNonEmptyArray(workflowRunIds)) {
			const runs = await repos.workflowRun.listByIdsAndStatus(context, workflowRunIds, "running");
			if (isNonEmptyArray(runs)) {
				await queueRetryableTaskRuns(context, repos, workflowRunPublisher, runs, { chunkSize });
			}
		}
	}

	if (timerSortedSet && isNonEmptyArray(tasksDueSoon)) {
		const timers: Array<{ type: "task_retry"; id: string; dueAt: number }> = [];
		for (const task of tasksDueSoon) {
			if (!task.dueAt) {
				context.logger.warn(
					{ workflowRunId: task.workflowRunId },
					"Missing dueAt for retryable task run, skipping promotion"
				);
				continue;
			}
			timers.push({
				type: "task_retry",
				id: task.workflowRunId,
				dueAt: new Date(task.dueAt).getTime(),
			});
		}
		await runConcurrently(context, chunkLazy(timers, chunkSize), async (chunk) => {
			await timerSortedSet.add(chunk);
		});
	}
}

export async function queueRetryableTaskRuns(
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<DueWorkflowRun>,
	options?: { chunkSize?: number }
) {
	const { chunkSize = 50 } = options ?? {};

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
			spanCtx.logger.warn({ err: error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

async function processChunk(
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<DueWorkflowRun>,
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
