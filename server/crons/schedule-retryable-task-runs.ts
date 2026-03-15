import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunStateScheduled } from "@aikirun/types/workflow-run";
import type { DatabaseConn } from "server/infra/db";
import type { StateTransitionRepository, StateTransitionRowInsert } from "server/infra/db/repository/state-transition";
import type { TaskRepository } from "server/infra/db/repository/task";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface ScheduleRetryableTaskRunsDeps {
	db: DatabaseConn;
	taskRepo: TaskRepository;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
}

export async function scheduleWorkflowRunsWithRetryableTask(
	context: CronContext,
	deps: ScheduleRetryableTaskRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const workflowRunIds = await deps.taskRepo.listRetryableTaskWorkflowRunIds(limit);
	if (!isNonEmptyArray(workflowRunIds)) {
		return;
	}

	const runs = await deps.workflowRunRepo.listByIdsAndStatus(workflowRunIds, "running");
	if (!isNonEmptyArray(runs)) {
		return;
	}

	await runConcurrently(context, chunkLazy(runs, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, deps, chunk);
		} catch (error) {
			spanCtx.logger.warn({ err: error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

async function processChunk(
	_context: CronContext,
	deps: ScheduleRetryableTaskRunsDeps,
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

	await deps.db.transaction(async (tx) => {
		await deps.stateTransitionRepo.appendBatch(stateTransitionEntries, tx);
		await deps.workflowRunRepo.bulkTransitionToScheduled("running", workflowRunUpdates, scheduledAt, tx);
	});
}
