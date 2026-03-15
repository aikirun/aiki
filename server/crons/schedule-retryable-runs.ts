import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunStateScheduled } from "@aikirun/types/workflow-run";
import type { DatabaseConn } from "server/infra/db";
import type { StateTransitionRepository, StateTransitionRowInsert } from "server/infra/db/repository/state-transition";
import type { TaskRepository } from "server/infra/db/repository/task";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface ScheduleRetryableRunsDeps {
	db: DatabaseConn;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
	taskRepo: TaskRepository;
}

export async function scheduleRetryableWorkflowRuns(
	context: CronContext,
	deps: ScheduleRetryableRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const runs = await deps.workflowRunRepo.listRetryableRuns(limit);
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
	deps: ScheduleRetryableRunsDeps,
	runs: NonEmptyArray<{ id: string; revision: number; attempts: number }>
) {
	const now = Date.now();
	const scheduledAt = new Date(now);

	const workflowRunIds = runs.map((run) => run.id);

	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: { id: string; revision: number; stateTransitionId: string }[] = [];

	for (const run of runs) {
		const stateTransitionId = ulid();
		const state: WorkflowRunStateScheduled = { status: "scheduled", scheduledAt: now, reason: "retry" };
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

	if (
		!isNonEmptyArray(workflowRunIds) ||
		!isNonEmptyArray(stateTransitionEntries) ||
		!isNonEmptyArray(workflowRunUpdates)
	) {
		return;
	}

	await deps.db.transaction(async (tx) => {
		await deps.taskRepo.deleteStaleByWorkflowRunIds(workflowRunIds, tx);
		await deps.stateTransitionRepo.appendBatch(stateTransitionEntries, tx);
		await deps.workflowRunRepo.bulkTransitionToScheduled("awaiting_retry", workflowRunUpdates, scheduledAt, tx);
	});
}
