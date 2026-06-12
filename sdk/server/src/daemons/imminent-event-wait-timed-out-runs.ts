import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { chunkLazy, isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";
import type { WorkflowRunState, WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { publishPendingOutboxEntries } from "./publish-ready-runs";
import type { Repositories } from "../infra/db/types";
import type { EventWaitQueueRowInsert } from "../infra/db/types/event-wait-queue";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRow } from "../infra/db/types/workflow";
import type { WorkflowRunMeta } from "../infra/db/types/workflow-run";
import type { WorkflowRunOutboxRowInsertPending } from "../infra/db/types/workflow-run-outbox";
import { runConcurrently } from "../lib/concurrency";
import type { Ranked } from "../lib/rank";
import { streamTimers } from "../lib/timer-stream";
import type { DaemonContext } from "../middleware/context";

type Repos = Pick<
	Repositories,
	"workflowRun" | "stateTransition" | "eventWaitQueue" | "workflow" | "workflowRunOutbox" | "transaction"
>;

export interface ProcessImminentEventWaitTimedOutRunsDeps {
	repos: Repos;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
}

export async function processImminentEventWaitTimedOutRuns(
	context: DaemonContext,
	{ repos, workflowRunPublisher, timerPriorityQueue }: ProcessImminentEventWaitTimedOutRunsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 1_000, imminenceThresholdMs = 3_000 } = options ?? {};

	const dueBefore = (Date.now() + imminenceThresholdMs) as TimestampMs;

	for await (const { dueNow: runsDueNow, dueSoon: runsDueSoon } of streamTimers(
		(cursor) => repos.workflowRun.listEventWaitTimedOutRuns(context, dueBefore, limit, cursor),
		{ until: (chunk) => chunk.length < limit }
	)) {
		if (isNonEmptyArray(runsDueNow)) {
			await queueEventWaitTimedOutRuns(context, repos, workflowRunPublisher, runsDueNow);
		}

		if (timerPriorityQueue && isNonEmptyArray(runsDueSoon)) {
			const timers: TimerEntry[] = runsDueSoon.map((run) => ({
				type: "event_wait_timeout",
				id: run.id,
				dueAt: run.dueAt,
				rank: run.rank,
			}));
			const result = await timerPriorityQueue.add(timers as NonEmptyArray<TimerEntry>);
			if (result.status === "failed") {
				context.logger.debug("Failed to add timers to priority queue", { count: timers.length });
			}
		}
	}
}

export async function queueEventWaitTimedOutRuns(
	context: DaemonContext,
	repos: Repos,
	workflowRunPublisher: Publisher | undefined,
	runs: NonEmptyArray<Ranked<WorkflowRunMeta>>,
	options?: { chunkSize?: number }
) {
	const { chunkSize = runs.length } = options ?? {};

	const stateTransitionIds: string[] = [];
	const workflowIdSet = new Set<string>();
	for (const run of runs) {
		stateTransitionIds.push(run.latestStateTransitionId);
		workflowIdSet.add(run.workflowId);
	}
	const workflowIds = Array.from(workflowIdSet) as NonEmptyArray<string>;

	const [stateTransitions, workflows] = await Promise.all([
		repos.stateTransition.getByIds(stateTransitionIds as NonEmptyArray<string>),
		repos.workflow.getByIdsGlobal(context, workflowIds),
	]);
	const stateTransitionsById = new Map(stateTransitions.map((transition) => [transition.id, transition]));
	const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

	await runConcurrently(context, chunkLazy(runs, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, repos, workflowRunPublisher, chunk, stateTransitionsById, workflowsById);
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
	stateTransitionsById: Map<string, { id: string; state: unknown }>,
	workflowsById: Map<string, WorkflowRow>
): Promise<void> {
	const timedOutAt = Date.now() as TimestampMs;

	const eventWaitEntries: EventWaitQueueRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: Array<{ filter: { id: string; revision: number }; update: { stateTransitionId: string } }> =
		[];
	const outboxEntries: WorkflowRunOutboxRowInsertPending[] = [];

	for (const run of runs) {
		const workflow = workflowsById.get(run.workflowId);
		if (!workflow) {
			continue;
		}

		const transition = stateTransitionsById.get(run.latestStateTransitionId);
		if (!transition) {
			continue;
		}
		const fromState = transition.state as WorkflowRunState;
		if (fromState.status !== "awaiting_event") {
			continue;
		}

		eventWaitEntries.push({
			id: ulid(),
			workflowRunId: run.id,
			name: fromState.eventName,
			status: "timeout",
			timedOutAt,
		});

		const stateTransitionId = ulid();
		const toState: WorkflowRunStateQueued = { status: "queued", reason: "event" };
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "queued",
			attempt: run.attempts,
			state: toState,
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
		const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued("awaiting_event", workflowRunUpdates);
		if (!isNonEmptyArray(transitionedRunIds)) {
			return [];
		}

		let eventWaitEntriesToInsert = eventWaitEntries;
		let stateTransitionEntriesToInsert = stateTransitionEntries;
		let outboxEntriesToInsert = outboxEntries;
		if (transitionedRunIds.length !== stateTransitionEntries.length) {
			const transitionedRunIdsSet = new Set(transitionedRunIds);
			eventWaitEntriesToInsert = eventWaitEntries.filter((entry) => transitionedRunIdsSet.has(entry.workflowRunId));
			stateTransitionEntriesToInsert = stateTransitionEntries.filter((entry) =>
				transitionedRunIdsSet.has(entry.workflowRunId)
			);
			outboxEntriesToInsert = outboxEntries.filter((entry) => transitionedRunIdsSet.has(entry.workflowRunId));
		}

		if (
			!isNonEmptyArray(eventWaitEntriesToInsert) ||
			!isNonEmptyArray(stateTransitionEntriesToInsert) ||
			!isNonEmptyArray(outboxEntriesToInsert)
		) {
			return [];
		}

		await txRepos.eventWaitQueue.insert(eventWaitEntriesToInsert);
		await txRepos.stateTransition.appendBatch(stateTransitionEntriesToInsert);
		await txRepos.workflowRunOutbox.createBatch(outboxEntriesToInsert);
		return outboxEntriesToInsert;
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishPendingOutboxEntries(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}
