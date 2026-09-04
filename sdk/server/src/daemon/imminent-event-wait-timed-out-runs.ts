import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { asNonEmptyArray, chunkLazy, isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunId, WorkflowRunState, WorkflowRunStateQueued } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { publishOutboxEntries, type RepublishBackoff } from "./publish-pending-outbox-entries";
import type { PageProcessingConfig } from "../config/runtime";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { EventWaitRowInsert } from "../infra/db/types/event-wait";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRow } from "../infra/db/types/workflow";
import type { WorkflowRunMeta } from "../infra/db/types/workflow-run";
import type { WorkflowRunOutboxRowInsertPending } from "../infra/db/types/workflow-run-outbox";
import { runConcurrently } from "../lib/concurrency";
import type { Ranked } from "../lib/rank";
import { streamTimers } from "../lib/timer-stream";
import type { DaemonContext } from "../middleware/context";

export interface ProcessImminentEventWaitTimedOutRunsDeps {
	repos: Repositories;
	publisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
}

export async function processImminentEventWaitTimedOutRuns(
	context: DaemonContext,
	{ repos, publisher, timerPriorityQueue }: ProcessImminentEventWaitTimedOutRunsDeps,
	config: PageProcessingConfig & { lookaheadWindowMs: number; republishBackoff: RepublishBackoff }
) {
	const { pageSize, lookaheadWindowMs, republishBackoff, chunk } = config;
	const dueBefore = (Date.now() + (timerPriorityQueue ? lookaheadWindowMs : 0)) as TimestampMs;

	for await (const { dueNow: runsDueNow, dueSoon: runsDueSoon } of streamTimers(
		(cursor) => repos.workflowRun.listEventWaitTimedOutRuns(context, dueBefore, pageSize, cursor),
		{ until: (page) => page.length < pageSize }
	)) {
		if (isNonEmptyArray(runsDueNow)) {
			await queueEventWaitTimedOutRuns(context, repos, publisher, republishBackoff, runsDueNow, { chunk });
		}

		if (timerPriorityQueue && isNonEmptyArray(runsDueSoon)) {
			const timers: TimerEntry[] = runsDueSoon.map((run) => ({
				type: "event_wait_timeout",
				id: run.id,
				rank: run.rank,
			}));
			const result = await timerPriorityQueue.add(timers as NonEmptyArray<TimerEntry>);
			if (result.status === "failed") {
				context.logger.debug("Failed to add timers to priority queue", { "aiki.count": timers.length });
			}
		}
	}
}

export async function queueEventWaitTimedOutRuns(
	context: DaemonContext,
	repos: Repositories,
	publisher: Publisher | undefined,
	republishBackoff: RepublishBackoff,
	runs: NonEmptyArray<Ranked<WorkflowRunMeta>>,
	options?: { chunk?: { size?: number; maxConcurrency?: number } }
) {
	const { size: chunkSize = runs.length, maxConcurrency } = options?.chunk ?? {};

	const stateTransitionIds: string[] = [];
	const workflowIdSet = new Set<string>();
	for (const run of runs) {
		stateTransitionIds.push(run.latestStateTransitionId);
		workflowIdSet.add(run.workflowId);
	}
	const workflowIds = Array.from(workflowIdSet) as NonEmptyArray<string>;

	const [stateTransitions, workflows] = await Promise.all([
		repos.stateTransition.getByIds(stateTransitionIds as NonEmptyArray<string>),
		repos.workflow.getByIds(context, workflowIds),
	]);
	const stateTransitionsById = new Map(stateTransitions.map((transition) => [transition.id, transition]));
	const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

	await runConcurrently(
		context,
		chunkLazy(runs, chunkSize),
		async (chunk, spanCtx) => {
			try {
				await processChunk(spanCtx, repos, publisher, republishBackoff, chunk, stateTransitionsById, workflowsById);
			} catch (err) {
				spanCtx.logger.warn("Failed to process chunk, will retry next tick", { err, "aiki.chunkSize": chunk.length });
			}
		},
		maxConcurrency ? { concurrency: maxConcurrency } : undefined
	);
}

async function processChunk(
	context: DaemonContext,
	repos: Repositories,
	publisher: Publisher | undefined,
	republishBackoff: RepublishBackoff,
	runs: NonEmptyArray<Ranked<WorkflowRunMeta>>,
	stateTransitionsById: Map<string, { id: string; state: unknown }>,
	workflowsById: Map<string, WorkflowRow>
): Promise<void> {
	const timedOutAt = Date.now() as TimestampMs;

	const eventWaitEntries: Omit<EventWaitRowInsert, "signalSequence">[] = [];
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
		const toState: WorkflowRunStateQueued = { status: "queued", reason: "event_wait_timeout" };
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
			workflowSource: workflow.source,
			workflowName: workflow.name,
			workflowVersionId: workflow.versionId,
			pool: run.options?.pool,
			rank: run.rank,
			nextPublishAttemptRank: run.rank,
			status: "pending",
		});
	}

	if (!isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	const insertedOutboxEntries = await repos.transaction(async (txRepos) =>
		transitionToQueuedInTx(
			context,
			{ workflowRunUpdates, eventWaitEntries, stateTransitionEntries, outboxEntries },
			txRepos
		)
	);

	if (publisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishOutboxEntries(context, repos, publisher, insertedOutboxEntries, republishBackoff);
	}
}

async function transitionToQueuedInTx(
	context: DaemonContext,
	entries: {
		workflowRunUpdates: NonEmptyArray<{
			filter: { id: string; revision: number };
			update: { stateTransitionId: string };
		}>;
		eventWaitEntries: Omit<EventWaitRowInsert, "signalSequence">[];
		stateTransitionEntries: StateTransitionRowInsert[];
		outboxEntries: WorkflowRunOutboxRowInsertPending[];
	},
	txRepos: TxRepositories
): Promise<WorkflowRunOutboxRowInsertPending[]> {
	const { workflowRunUpdates, eventWaitEntries, stateTransitionEntries, outboxEntries } = entries;
	const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued(
		context,
		"awaiting_event",
		workflowRunUpdates
	);
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

	const incrementedRuns = await txRepos.workflowRun.bulkIncrementSignalSequence(
		asNonEmptyArray(
			outboxEntriesToInsert.map((entry) => ({
				namespaceId: entry.namespaceId as NamespaceId,
				id: entry.workflowRunId as WorkflowRunId,
			}))
		)
	);
	const incrementedRunsById = new Map(incrementedRuns.map((run) => [run.id, run]));
	const sequenceStampedEventWaitEntries = eventWaitEntriesToInsert.map((entry) => {
		const incrementedRun = incrementedRunsById.get(entry.workflowRunId);
		if (!incrementedRun) {
			throw new Error(`Run not found: ${entry.workflowRunId}`);
		}
		return { ...entry, signalSequence: incrementedRun.signalSequence };
	});

	await txRepos.eventWait.insert(sequenceStampedEventWaitEntries);
	await txRepos.stateTransition.appendBatch(stateTransitionEntriesToInsert);
	await txRepos.workflowRunOutbox.createBatch(outboxEntriesToInsert);
	return outboxEntriesToInsert;
}
