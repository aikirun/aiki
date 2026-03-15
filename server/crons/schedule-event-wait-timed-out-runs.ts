import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunState, WorkflowRunStateScheduled } from "@aikirun/types/workflow-run";
import type { DatabaseConn } from "server/infra/db";
import type { EventWaitQueueRepository, EventWaitQueueRowInsert } from "server/infra/db/repository/event-wait-queue";
import type { StateTransitionRepository, StateTransitionRowInsert } from "server/infra/db/repository/state-transition";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface ScheduleEventWaitTimedOutRunsDeps {
	db: DatabaseConn;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
	eventWaitQueueRepo: EventWaitQueueRepository;
}

export async function scheduleEventWaitTimedOutWorkflowRuns(
	context: CronContext,
	deps: ScheduleEventWaitTimedOutRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const runs = await deps.workflowRunRepo.listEventWaitTimedOutRuns(limit);
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
		const stateTransition = stateTransitionsById.get(run.latestStateTransitionId);
		if (!stateTransition) {
			context.logger.warn(
				{ runId: run.id, transitionId: run.latestStateTransitionId },
				"State transition not found, skipping"
			);
			continue;
		}
		const state = stateTransition.state as WorkflowRunState;
		if (state.status !== "awaiting_event") {
			continue;
		}
		enrichedRuns.push({
			id: run.id,
			revision: run.revision,
			attempts: run.attempts,
			eventName: state.eventName,
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
	eventName: string;
}

async function processChunk(
	_context: CronContext,
	deps: ScheduleEventWaitTimedOutRunsDeps,
	runs: NonEmptyArray<EnrichedWorkflowRun>
) {
	const now = Date.now();
	const timedOutAt = new Date(now);

	const eventWaitEntries: EventWaitQueueRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: { id: string; revision: number; stateTransitionId: string }[] = [];

	for (const run of runs) {
		eventWaitEntries.push({
			id: ulid(),
			workflowRunId: run.id,
			name: run.eventName,
			status: "timeout",
			timedOutAt,
		});

		const stateTransitionId = ulid();
		const state: WorkflowRunStateScheduled = { status: "scheduled", scheduledAt: now, reason: "event" };
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
		!isNonEmptyArray(eventWaitEntries) ||
		!isNonEmptyArray(stateTransitionEntries) ||
		!isNonEmptyArray(workflowRunUpdates)
	) {
		return;
	}

	await deps.db.transaction(async (tx) => {
		await deps.eventWaitQueueRepo.insert(eventWaitEntries, tx);
		await deps.stateTransitionRepo.appendBatch(stateTransitionEntries, tx);
		await deps.workflowRunRepo.bulkTransitionToScheduled("awaiting_event", workflowRunUpdates, timedOutAt, tx);
	});
}
