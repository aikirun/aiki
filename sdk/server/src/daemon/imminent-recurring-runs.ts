import { streamChunks } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { asNonEmptyArray, isNonEmptyArray, partitionArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OpaquePayload } from "@aikirun/types/payload";
import type { Schedule, ScheduleOverlapPolicy } from "@aikirun/types/schedule";
import {
	NON_TERMINAL_WORKFLOW_RUN_STATUSES,
	type WorkflowRunId,
	type WorkflowRunStateCancelled,
	type WorkflowRunStateQueued,
} from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { publishOutboxEntries, type RepublishBackoff } from "./publish-pending-outbox-entries";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { ScheduleOccurrenceUpdate } from "../infra/db/types/schedule";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRunRowInsert } from "../infra/db/types/workflow-run";
import type { WorkflowRunOutboxRowInsertPending } from "../infra/db/types/workflow-run-outbox";
import { createKeysetStreamCursorAdvancer } from "../lib/keyset-stream";
import { computeRank } from "../lib/rank";
import type { DaemonContext } from "../middleware/context";
import type { CancelledRunMeta, ChildRunCanceller } from "../service/cancel-child-runs";
import { deliverTerminatedSignalToParentRun, type TerminatedChildRun } from "../service/deliver-terminated-signals";
import { discardStaleTasks } from "../service/discard-stale-tasks";
import { getDueOccurrences, getNextOccurrence, getReferenceId, scheduleRowToDomain } from "../service/schedule";

export interface ProcessImminentRecurringRunsDeps {
	repos: Repositories;
	childRunCanceller: ChildRunCanceller;
	publisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
}

export type DueSchedule = Schedule & {
	workflowId: string;
	namespaceId: NamespaceId;
	workflowRunInput: OpaquePayload | null;
	workflowRunInputHash: string;
	clientCodecApplied: boolean;
};

const advanceScheduleCursor = createKeysetStreamCursorAdvancer<{ schedule: { id: string; nextRunAt: TimestampMs } }>({
	getOrder: (row) => row.schedule.nextRunAt,
	getId: (row) => row.schedule.id,
});

export async function processImminentRecurringRuns(
	context: DaemonContext,
	deps: ProcessImminentRecurringRunsDeps,
	config: { limit: number; lookaheadWindowMs: number; republishBackoff: RepublishBackoff }
) {
	const { limit, lookaheadWindowMs, republishBackoff } = config;
	const dueBefore = (Date.now() + (deps.timerPriorityQueue ? lookaheadWindowMs : 0)) as TimestampMs;

	for await (const rows of streamChunks(
		(cursor) => deps.repos.schedule.listDueSchedules(context, dueBefore, limit, cursor),
		{
			advanceCursor: advanceScheduleCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		const schedules: DueSchedule[] = rows.map(({ schedule, workflow }) => ({
			...scheduleRowToDomain(schedule, workflow),
			workflowId: schedule.workflowId,
			namespaceId: schedule.namespaceId as NamespaceId,
			workflowRunInput: schedule.workflowRunInput,
			workflowRunInputHash: schedule.workflowRunInputHash,
			clientCodecApplied: schedule.clientCodecApplied,
		}));

		const now = Date.now();
		const { whenTrue: schedulesDueNow, whenFalse: schedulesDueSoon } = partitionArray(schedules, (schedule) => ({
			meetsCondition: schedule.nextRunAt <= now,
			item: schedule,
		}));

		if (isNonEmptyArray(schedulesDueNow)) {
			await queueRecurringRuns(context, deps, schedulesDueNow, republishBackoff);
		}

		const { timerPriorityQueue } = deps;
		if (timerPriorityQueue && isNonEmptyArray(schedulesDueSoon)) {
			const timers: TimerEntry[] = schedulesDueSoon.map((schedule) => ({
				type: "recurring",
				id: schedule.id,
				rank: computeRank({ dueAt: schedule.nextRunAt, priority: schedule.workflowRunOptions?.priority }),
			}));
			const result = await timerPriorityQueue.add(timers as NonEmptyArray<TimerEntry>);
			if (result.status === "failed") {
				context.logger.debug("Failed to add timers to priority queue", { "aiki.count": timers.length });
			}
		}
	}
}

export async function queueRecurringRuns(
	context: DaemonContext,
	deps: ProcessImminentRecurringRunsDeps,
	schedules: NonEmptyArray<DueSchedule>,
	republishBackoff: RepublishBackoff
) {
	const now = Date.now();

	const allowSchedules: DueSchedule[] = [];
	const skipSchedules: DueSchedule[] = [];
	const cancelPreviousSchedules: DueSchedule[] = [];

	for (const schedule of schedules) {
		const overlapPolicy: ScheduleOverlapPolicy = schedule.spec.overlapPolicy ?? "skip";
		if (overlapPolicy === "allow") {
			allowSchedules.push(schedule);
		} else if (overlapPolicy === "skip") {
			skipSchedules.push(schedule);
		} else {
			overlapPolicy satisfies "cancel_previous";
			cancelPreviousSchedules.push(schedule);
		}
	}

	const results = await Promise.allSettled([
		isNonEmptyArray(allowSchedules)
			? processOverlapAllowSchedules(context, deps.repos, allowSchedules, now, deps.publisher, republishBackoff)
			: undefined,
		isNonEmptyArray(skipSchedules)
			? processOverlapSkipSchedules(context, deps.repos, skipSchedules, now, deps.publisher, republishBackoff)
			: undefined,
		isNonEmptyArray(cancelPreviousSchedules)
			? processOverlapCancelPreviousSchedules(context, deps, cancelPreviousSchedules, now, republishBackoff)
			: undefined,
	]);

	for (const result of results) {
		if (result.status === "rejected") {
			context.logger.warn("Failed to process recurring schedules batch, will retry next tick", { err: result.reason });
		}
	}
}

async function processOverlapAllowSchedules(
	context: DaemonContext,
	repos: Repositories,
	schedules: NonEmptyArray<DueSchedule>,
	now: number,
	publisher: Publisher | undefined,
	republishBackoff: RepublishBackoff
) {
	const workflowRunEntries: WorkflowRunRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const outboxEntries: WorkflowRunOutboxRowInsertPending[] = [];
	const scheduleUpdates: ScheduleOccurrenceUpdate[] = [];

	for (const schedule of schedules) {
		const occurrences = getDueOccurrences(schedule, now);
		if (!isNonEmptyArray(occurrences)) {
			continue;
		}

		for (const occurrence of occurrences) {
			const runId = ulid() as WorkflowRunId;
			const stateTransitionId = ulid();
			const referenceId = getReferenceId(schedule.id, occurrence);

			workflowRunEntries.push({
				id: runId,
				namespaceId: schedule.namespaceId,
				workflowId: schedule.workflowId,
				scheduleId: schedule.id,
				status: "queued",
				clientCodecApplied: schedule.clientCodecApplied,
				input: schedule.workflowRunInput,
				inputHash: schedule.workflowRunInputHash,
				options: schedule.workflowRunOptions,
				referenceId,
				latestStateTransitionId: stateTransitionId,
			});
			stateTransitionEntries.push({
				id: stateTransitionId,
				workflowRunId: runId,
				type: "workflow_run",
				status: "queued",
				attempt: 1,
				state: { status: "queued", reason: "new" } satisfies WorkflowRunStateQueued,
			});
			const rank = computeRank({ dueAt: occurrence, priority: schedule.workflowRunOptions?.priority });
			outboxEntries.push({
				id: ulid(),
				namespaceId: schedule.namespaceId,
				workflowRunId: runId,
				workflowSource: schedule.workflowSource,
				workflowName: schedule.workflowName,
				workflowVersionId: schedule.workflowVersionId,
				rank,
				nextPublishAttemptRank: rank,
				pool: schedule.workflowRunOptions?.pool ?? null,
				status: "pending",
			});
		}

		// biome-ignore lint/style/noNonNullAssertion: isNonEmptyArray guarantees at least one element
		const lastOccurrence = occurrences.at(-1)!;
		scheduleUpdates.push({
			filter: { id: schedule.id, nextRunAt: schedule.nextRunAt as TimestampMs },
			update: {
				lastOccurrence: lastOccurrence as TimestampMs,
				nextRunAt: getNextOccurrence(schedule.spec, lastOccurrence) as TimestampMs,
			},
		});
	}

	if (
		!isNonEmptyArray(workflowRunEntries) ||
		!isNonEmptyArray(stateTransitionEntries) ||
		!isNonEmptyArray(outboxEntries) ||
		!isNonEmptyArray(scheduleUpdates)
	) {
		return;
	}

	await repos.transaction(async (txRepos) =>
		insertRecurringRunsInTx({ workflowRunEntries, stateTransitionEntries, scheduleUpdates, outboxEntries }, txRepos)
	);

	if (publisher) {
		await publishOutboxEntries(context, repos, publisher, outboxEntries, republishBackoff);
	}
}

async function insertRecurringRunsInTx(
	entries: {
		workflowRunEntries: NonEmptyArray<WorkflowRunRowInsert>;
		stateTransitionEntries: NonEmptyArray<StateTransitionRowInsert>;
		scheduleUpdates: NonEmptyArray<ScheduleOccurrenceUpdate>;
		outboxEntries: NonEmptyArray<WorkflowRunOutboxRowInsertPending>;
	},
	txRepos: TxRepositories
): Promise<void> {
	await txRepos.workflowRun.insert(entries.workflowRunEntries);
	await txRepos.stateTransition.appendBatch(entries.stateTransitionEntries);
	await txRepos.schedule.bulkUpdateOccurrence(entries.scheduleUpdates);
	await txRepos.workflowRunOutbox.createBatch(entries.outboxEntries);
}

async function processOverlapSkipSchedules(
	context: DaemonContext,
	repos: Repositories,
	schedules: NonEmptyArray<DueSchedule>,
	now: number,
	publisher: Publisher | undefined,
	republishBackoff: RepublishBackoff
) {
	const { activeRunsByScheduleId } = await fetchActiveRunsBySchedule(repos, schedules);

	const workflowRunEntries: WorkflowRunRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const outboxEntries: WorkflowRunOutboxRowInsertPending[] = [];
	const scheduleUpdates: ScheduleOccurrenceUpdate[] = [];

	for (const schedule of schedules) {
		const occurrences = getDueOccurrences(schedule, now);
		if (!isNonEmptyArray(occurrences)) {
			continue;
		}
		const occurrence = occurrences[0];

		if (activeRunsByScheduleId.has(schedule.id)) {
			scheduleUpdates.push({
				filter: { id: schedule.id, nextRunAt: schedule.nextRunAt as TimestampMs },
				update: { nextRunAt: getNextOccurrence(schedule.spec, occurrence) as TimestampMs },
			});
			continue;
		}

		const runId = ulid() as WorkflowRunId;
		const stateTransitionId = ulid();
		const referenceId = getReferenceId(schedule.id, occurrence);

		workflowRunEntries.push({
			id: runId,
			namespaceId: schedule.namespaceId,
			workflowId: schedule.workflowId,
			scheduleId: schedule.id,
			status: "queued",
			clientCodecApplied: schedule.clientCodecApplied,
			input: schedule.workflowRunInput,
			inputHash: schedule.workflowRunInputHash,
			options: schedule.workflowRunOptions,
			referenceId,
			latestStateTransitionId: stateTransitionId,
		});
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: runId,
			type: "workflow_run",
			status: "queued",
			attempt: 1,
			state: { status: "queued", reason: "new" } satisfies WorkflowRunStateQueued,
		});
		const rank = computeRank({ dueAt: occurrence, priority: schedule.workflowRunOptions?.priority });
		outboxEntries.push({
			id: ulid(),
			namespaceId: schedule.namespaceId,
			workflowRunId: runId,
			workflowSource: schedule.workflowSource,
			workflowName: schedule.workflowName,
			workflowVersionId: schedule.workflowVersionId,
			rank,
			nextPublishAttemptRank: rank,
			pool: schedule.workflowRunOptions?.pool ?? null,
			status: "pending",
		});
		scheduleUpdates.push({
			filter: { id: schedule.id, nextRunAt: schedule.nextRunAt as TimestampMs },
			update: {
				lastOccurrence: occurrence as TimestampMs,
				nextRunAt: getNextOccurrence(schedule.spec, occurrence) as TimestampMs,
			},
		});
	}

	if (!isNonEmptyArray(scheduleUpdates)) {
		return;
	}

	const insertedOutboxEntries = await repos.transaction(async (txRepos) =>
		insertRunsAndAdvanceSchedulesInTx(
			{ workflowRunEntries, stateTransitionEntries, scheduleUpdates, outboxEntries },
			txRepos
		)
	);

	if (publisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishOutboxEntries(context, repos, publisher, insertedOutboxEntries, republishBackoff);
	}
}

async function insertRunsAndAdvanceSchedulesInTx(
	entries: {
		workflowRunEntries: WorkflowRunRowInsert[];
		stateTransitionEntries: StateTransitionRowInsert[];
		scheduleUpdates: NonEmptyArray<ScheduleOccurrenceUpdate>;
		outboxEntries: WorkflowRunOutboxRowInsertPending[];
	},
	txRepos: TxRepositories
): Promise<WorkflowRunOutboxRowInsertPending[]> {
	const { workflowRunEntries, stateTransitionEntries, scheduleUpdates, outboxEntries } = entries;
	if (isNonEmptyArray(workflowRunEntries) && isNonEmptyArray(stateTransitionEntries)) {
		await txRepos.workflowRun.insert(workflowRunEntries);
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
	}
	await txRepos.schedule.bulkUpdateOccurrence(scheduleUpdates);
	if (!isNonEmptyArray(outboxEntries)) {
		return [];
	}
	await txRepos.workflowRunOutbox.createBatch(outboxEntries);
	return outboxEntries;
}

async function processOverlapCancelPreviousSchedules(
	context: DaemonContext,
	deps: ProcessImminentRecurringRunsDeps,
	schedules: NonEmptyArray<DueSchedule>,
	now: number,
	republishBackoff: RepublishBackoff
) {
	const { activeRunsByScheduleId } = await fetchActiveRunsBySchedule(deps.repos, schedules);

	const runIdsToCancel: string[] = [];
	const runsToCancel: Array<{
		id: string;
		attempts: number;
		namespaceId: NamespaceId;
		pool?: string;
		priority?: number;
	}> = [];

	const newWorkflowRunEntries: WorkflowRunRowInsert[] = [];
	const newRunStateTransitionEntries: StateTransitionRowInsert[] = [];
	const newOutboxEntries: WorkflowRunOutboxRowInsertPending[] = [];
	const scheduleUpdates: ScheduleOccurrenceUpdate[] = [];

	for (const schedule of schedules) {
		const occurrences = getDueOccurrences(schedule, now);
		if (!isNonEmptyArray(occurrences)) {
			continue;
		}
		const occurrence = occurrences[0];

		const activeRun = activeRunsByScheduleId.get(schedule.id);
		if (activeRun) {
			runIdsToCancel.push(activeRun.id);
			runsToCancel.push({
				...activeRun,
				namespaceId: schedule.namespaceId,
			});
		}

		const runId = ulid() as WorkflowRunId;
		const stateTransitionId = ulid();
		const referenceId = getReferenceId(schedule.id, occurrence);

		newWorkflowRunEntries.push({
			id: runId,
			namespaceId: schedule.namespaceId,
			workflowId: schedule.workflowId,
			scheduleId: schedule.id,
			status: "queued",
			clientCodecApplied: schedule.clientCodecApplied,
			input: schedule.workflowRunInput,
			inputHash: schedule.workflowRunInputHash,
			options: schedule.workflowRunOptions,
			referenceId,
			latestStateTransitionId: stateTransitionId,
		});
		newRunStateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: runId,
			type: "workflow_run",
			status: "queued",
			attempt: 1,
			state: { status: "queued", reason: "new" } satisfies WorkflowRunStateQueued,
		});
		const rank = computeRank({ dueAt: occurrence, priority: schedule.workflowRunOptions?.priority });
		newOutboxEntries.push({
			id: ulid(),
			namespaceId: schedule.namespaceId,
			workflowRunId: runId,
			workflowSource: schedule.workflowSource,
			workflowName: schedule.workflowName,
			workflowVersionId: schedule.workflowVersionId,
			rank,
			nextPublishAttemptRank: rank,
			pool: schedule.workflowRunOptions?.pool ?? null,
			status: "pending",
		});
		scheduleUpdates.push({
			filter: { id: schedule.id, nextRunAt: schedule.nextRunAt as TimestampMs },
			update: {
				lastOccurrence: occurrence as TimestampMs,
				nextRunAt: getNextOccurrence(schedule.spec, occurrence) as TimestampMs,
			},
		});
	}

	if (
		!isNonEmptyArray(newWorkflowRunEntries) ||
		!isNonEmptyArray(newRunStateTransitionEntries) ||
		!isNonEmptyArray(scheduleUpdates)
	) {
		return;
	}

	const insertedOutboxEntries = await deps.repos.transaction(async (txRepos) =>
		cancelPreviousAndInsertRunsInTx(
			context,
			deps.childRunCanceller,
			now as TimestampMs,
			{
				runIdsToCancel,
				runsToCancel,
				newWorkflowRunEntries,
				newRunStateTransitionEntries,
				scheduleUpdates,
				newOutboxEntries,
			},
			txRepos
		)
	);

	if (deps.publisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishOutboxEntries(context, deps.repos, deps.publisher, insertedOutboxEntries, republishBackoff);
	}
}

async function cancelPreviousAndInsertRunsInTx(
	context: DaemonContext,
	childRunCanceller: ChildRunCanceller,
	now: TimestampMs,
	entries: {
		runIdsToCancel: string[];
		runsToCancel: Array<{ id: string; attempts: number; namespaceId: NamespaceId; pool?: string; priority?: number }>;
		newWorkflowRunEntries: NonEmptyArray<WorkflowRunRowInsert>;
		newRunStateTransitionEntries: NonEmptyArray<StateTransitionRowInsert>;
		scheduleUpdates: NonEmptyArray<ScheduleOccurrenceUpdate>;
		newOutboxEntries: WorkflowRunOutboxRowInsertPending[];
	},
	txRepos: TxRepositories
): Promise<WorkflowRunOutboxRowInsertPending[]> {
	const {
		runIdsToCancel,
		runsToCancel,
		newWorkflowRunEntries,
		newRunStateTransitionEntries,
		scheduleUpdates,
		newOutboxEntries,
	} = entries;
	// To escape the race condition that might arise when a concurrent actor moves the runId to non cancellable state,
	// we should only insert cancellation state transitions if the cancellation occurred, otherwise, we'll have dangling transitions

	// Step 1: Cancel active runs (without setting latestStateTransitionId)
	const cancelledRuns = isNonEmptyArray(runIdsToCancel)
		? await txRepos.workflowRun.bulkTransitionToCancelled(context, runIdsToCancel)
		: [];
	const cancelledRunsById = new Map(cancelledRuns.map((run) => [run.id, run]));

	// Step 2: Discard in-flight tasks and outbox entries for the cancelled runs, then insert
	// cancel state transitions only for actually cancelled runs and set latestStateTransitionId
	if (cancelledRunsById.size) {
		const cancelledRunIds = asNonEmptyArray(Array.from(cancelledRunsById.keys()));
		await discardStaleTasks(cancelledRunIds, ["running", "awaiting_retry"], txRepos);
		await txRepos.sleep.bulkCancelByWorkflowRunIds(cancelledRunIds, now);
		await txRepos.workflowRunOutbox.deleteByWorkflowRunIds(cancelledRunIds);

		const cancelStateTransitionEntries: StateTransitionRowInsert[] = [];
		const cancelledRunStateTransitionIdUpdates: {
			filter: { namespaceId: NamespaceId; id: string };
			update: { stateTransitionId: string };
		}[] = [];
		const cancelledRunsMeta: CancelledRunMeta[] = [];
		const cancelledRunsHavingParent: TerminatedChildRun[] = [];

		for (const run of runsToCancel) {
			const cancelledRun = cancelledRunsById.get(run.id);
			if (!cancelledRun) {
				continue;
			}

			const stateTransitionId = ulid();
			cancelStateTransitionEntries.push({
				id: stateTransitionId,
				workflowRunId: run.id,
				type: "workflow_run",
				status: "cancelled",
				attempt: run.attempts,
				state: { status: "cancelled", explanation: "Schedule overlap policy" } satisfies WorkflowRunStateCancelled,
			});
			cancelledRunStateTransitionIdUpdates.push({
				filter: { namespaceId: run.namespaceId, id: run.id },
				update: { stateTransitionId },
			});
			cancelledRunsMeta.push({ namespaceId: run.namespaceId, id: run.id, pool: run.pool, priority: run.priority });

			if (cancelledRun.parentWorkflowRunId !== null) {
				cancelledRunsHavingParent.push({
					namespaceId: run.namespaceId,
					id: run.id,
					latestStateTransitionId: stateTransitionId,
					parentWorkflowRunId: cancelledRun.parentWorkflowRunId,
					status: "cancelled",
				});
			}
		}

		if (isNonEmptyArray(cancelStateTransitionEntries) && isNonEmptyArray(cancelledRunStateTransitionIdUpdates)) {
			await txRepos.stateTransition.appendBatch(cancelStateTransitionEntries);
			await txRepos.workflowRun.bulkSetLatestStateTransitionId(cancelledRunStateTransitionIdUpdates);
		}
		if (isNonEmptyArray(cancelledRunsHavingParent)) {
			// No imminent timer queue: schedule occurrences have no parents today, so this wakes
			// nobody. If occurrences ever gain parents, thread the queue through the daemon deps.
			await deliverTerminatedSignalToParentRun(cancelledRunsHavingParent, now, txRepos, context.logger, undefined);
		}
		if (isNonEmptyArray(cancelledRunsMeta)) {
			await childRunCanceller.cancel(cancelledRunsMeta, txRepos, context.logger);
		}
	}

	// Step 3: Create new workflow runs, their state transitions, and outbox entries
	await txRepos.workflowRun.insert(newWorkflowRunEntries);
	await txRepos.stateTransition.appendBatch(newRunStateTransitionEntries);
	await txRepos.schedule.bulkUpdateOccurrence(scheduleUpdates);
	if (!isNonEmptyArray(newOutboxEntries)) {
		return [];
	}
	await txRepos.workflowRunOutbox.createBatch(newOutboxEntries);
	return newOutboxEntries;
}

async function fetchActiveRunsBySchedule(repos: Repositories, schedules: NonEmptyArray<DueSchedule>) {
	const workflowAndReferenceIdPairs: { namespaceId: NamespaceId; workflowId: string; referenceId: string }[] = [];
	const schedulesByWorkflowAndReferenceId = new Map<string, Map<string, DueSchedule>>();

	for (const schedule of schedules) {
		if (schedule.lastOccurrence === undefined) {
			continue;
		}
		const referenceId = getReferenceId(schedule.id, schedule.lastOccurrence);
		workflowAndReferenceIdPairs.push({
			namespaceId: schedule.namespaceId,
			workflowId: schedule.workflowId,
			referenceId,
		});

		let schedulesByReferenceId = schedulesByWorkflowAndReferenceId.get(schedule.workflowId);
		if (!schedulesByReferenceId) {
			schedulesByReferenceId = new Map();
			schedulesByWorkflowAndReferenceId.set(schedule.workflowId, schedulesByReferenceId);
		}
		schedulesByReferenceId.set(referenceId, schedule);
	}

	const activeRunsByScheduleId = new Map<string, { id: string; attempts: number; pool?: string; priority?: number }>();

	if (isNonEmptyArray(workflowAndReferenceIdPairs) && isNonEmptyArray(NON_TERMINAL_WORKFLOW_RUN_STATUSES)) {
		const activeRuns = await repos.workflowRun.listByWorkflowAndReferenceIdPairs({
			pairs: workflowAndReferenceIdPairs,
			status: NON_TERMINAL_WORKFLOW_RUN_STATUSES,
		});

		for (const run of activeRuns) {
			if (run.referenceId) {
				const schedule = schedulesByWorkflowAndReferenceId.get(run.workflowId)?.get(run.referenceId);
				if (schedule) {
					activeRunsByScheduleId.set(schedule.id, {
						id: run.id,
						attempts: run.attempts,
						pool: run.options?.pool,
						priority: run.options?.priority,
					});
				}
			}
		}
	}

	return { activeRunsByScheduleId };
}
