import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type {
	TerminalWorkflowRunStatus,
	WorkflowRunState,
	WorkflowRunStateScheduled,
} from "@aikirun/types/workflow-run";
import type { DatabaseConn } from "server/infra/db";
import type {
	ChildWorkflowRunWaitQueueRepository,
	ChildWorkflowRunWaitQueueRowInsert,
} from "server/infra/db/repository/child-workflow-run-wait-queue";
import type { StateTransitionRepository, StateTransitionRowInsert } from "server/infra/db/repository/state-transition";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface ScheduleChildRunWaitTimedOutRunsDeps {
	db: DatabaseConn;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
	childWorkflowRunWaitQueueRepo: ChildWorkflowRunWaitQueueRepository;
}

export async function scheduleChildRunWaitTimedOutWorkflowRuns(
	context: CronContext,
	deps: ScheduleChildRunWaitTimedOutRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const runs = await deps.workflowRunRepo.listChildRunWaitTimedOutRuns(limit);
	if (!isNonEmptyArray(runs)) {
		return;
	}

	const stateTransitionIds = runs.map((run) => run.latestStateTransitionId);
	if (!isNonEmptyArray(stateTransitionIds)) {
		return;
	}

	const stateTransitions = await deps.stateTransitionRepo.getByIds(stateTransitionIds);
	const stateTransitionsById = new Map(stateTransitions.map((t) => [t.id, t]));

	const enrichedRuns: EnrichedWorkflowRun[] = [];
	for (const run of runs) {
		const transition = stateTransitionsById.get(run.latestStateTransitionId);
		if (!transition) {
			context.logger.warn(
				{ runId: run.id, transitionId: run.latestStateTransitionId },
				"State transition not found, skipping"
			);
			continue;
		}
		const state = transition.state as WorkflowRunState;
		if (state.status !== "awaiting_child_workflow") {
			continue;
		}
		enrichedRuns.push({
			id: run.id,
			revision: run.revision,
			attempts: run.attempts,
			childWorkflowRunId: state.childWorkflowRunId,
			childWorkflowRunStatus: state.childWorkflowRunStatus,
		});
	}

	if (!isNonEmptyArray(enrichedRuns)) {
		return;
	}

	await runConcurrently(context, chunkLazy(enrichedRuns, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, deps, chunk);
		} catch (error) {
			spanCtx.logger.warn({ err: error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

interface EnrichedWorkflowRun {
	id: string;
	revision: number;
	attempts: number;
	childWorkflowRunId: string;
	childWorkflowRunStatus: TerminalWorkflowRunStatus;
}

async function processChunk(
	_context: CronContext,
	deps: ScheduleChildRunWaitTimedOutRunsDeps,
	runs: NonEmptyArray<EnrichedWorkflowRun>
) {
	const now = Date.now();
	const timedOutAt = new Date(now);

	const childRunWaitEntries: ChildWorkflowRunWaitQueueRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: { id: string; revision: number; stateTransitionId: string }[] = [];

	for (const run of runs) {
		childRunWaitEntries.push({
			id: ulid(),
			parentWorkflowRunId: run.id,
			childWorkflowRunId: run.childWorkflowRunId,
			childWorkflowRunStatus: run.childWorkflowRunStatus,
			status: "timeout",
			timedOutAt: timedOutAt,
		});

		const stateTransitionId = ulid();
		const state: WorkflowRunStateScheduled = { status: "scheduled", scheduledAt: now, reason: "child_workflow" };
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
		!isNonEmptyArray(childRunWaitEntries) ||
		!isNonEmptyArray(stateTransitionEntries) ||
		!isNonEmptyArray(workflowRunUpdates)
	) {
		return;
	}

	await deps.db.transaction(async (tx) => {
		await deps.childWorkflowRunWaitQueueRepo.insert(childRunWaitEntries, tx);
		await deps.stateTransitionRepo.appendBatch(stateTransitionEntries, tx);
		await deps.workflowRunRepo.bulkTransitionToScheduled("awaiting_child_workflow", workflowRunUpdates, timedOutAt, tx);
	});
}
