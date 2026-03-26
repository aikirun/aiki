import type { NonEmptyArray } from "@aikirun/lib/array";
import { chunkLazy, isNonEmptyArray } from "@aikirun/lib/array";
import type { WorkflowRunStateScheduled } from "@aikirun/types/workflow-run";
import type { Repositories, StateTransitionRowInsert } from "server/infra/db/types";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface ScheduleRetryableTaskRunsDeps {
	repos: Pick<Repositories, "task" | "workflowRun" | "stateTransition" | "transaction">;
}

export async function scheduleWorkflowRunsWithRetryableTask(
	context: CronContext,
	{ repos }: ScheduleRetryableTaskRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const workflowRunIds = await repos.task.listRetryableTaskWorkflowRunIds(limit);
	if (!isNonEmptyArray(workflowRunIds)) {
		return;
	}

	const runs = await repos.workflowRun.listByIdsAndStatus(workflowRunIds, "running");
	if (!isNonEmptyArray(runs)) {
		return;
	}

	await runConcurrently(context, chunkLazy(runs, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, repos, chunk);
		} catch (error) {
			spanCtx.logger.warn({ err: error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

async function processChunk(
	_context: CronContext,
	repos: ScheduleRetryableTaskRunsDeps["repos"],
	runs: NonEmptyArray<{ id: string; revision: number; attempts: number }>
) {
	const now = Date.now();
	const scheduledAt = new Date(now);

	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: { id: string; revision: number; stateTransitionId: string }[] = [];

	for (const run of runs) {
		const stateTransitionId = ulid();
		const state: WorkflowRunStateScheduled = { status: "scheduled", scheduledAt: now, reason: "task_retry" };
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "scheduled",
			attempt: run.attempts,
			state,
		});
		workflowRunUpdates.push({
			id: run.id,
			revision: run.revision,
			stateTransitionId,
		});
	}

	if (!isNonEmptyArray(stateTransitionEntries) || !isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	await repos.transaction(async (txRepos) => {
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		await txRepos.workflowRun.bulkTransitionToScheduled("running", workflowRunUpdates, scheduledAt);
	});
}
