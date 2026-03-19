import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunState, WorkflowRunStateScheduled } from "@aikirun/types/workflow-run";
import type { EventWaitQueueRowInsert, Repositories, StateTransitionRowInsert } from "server/infra/db/types";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface ScheduleEventWaitTimedOutRunsDeps {
	repos: Pick<Repositories, "workflowRun" | "stateTransition" | "eventWaitQueue" | "transaction">;
}

export async function scheduleEventWaitTimedOutWorkflowRuns(
	context: CronContext,
	{ repos }: ScheduleEventWaitTimedOutRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const runs = await repos.workflowRun.listEventWaitTimedOutRuns(limit);
	if (!isNonEmptyArray(runs)) {
		return;
	}

	const stateTransitionIds = runs.map((run) => run.latestStateTransitionId);
	if (!isNonEmptyArray(stateTransitionIds)) {
		return;
	}

	const stateTransitions = await repos.stateTransition.getByIds(stateTransitionIds);
	const stateTransitionsById = new Map(stateTransitions.map((transition) => [transition.id, transition]));

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
			await processChunk(spanCtx, repos, chunk);
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
	repos: ScheduleEventWaitTimedOutRunsDeps["repos"],
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

	await repos.transaction(async (txRepos) => {
		await txRepos.eventWaitQueue.insert(eventWaitEntries);
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		await txRepos.workflowRun.bulkTransitionToScheduled("awaiting_event", workflowRunUpdates, timedOutAt);
	});
}
