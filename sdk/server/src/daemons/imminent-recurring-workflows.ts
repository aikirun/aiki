import { streamChunks } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { isNonEmptyArray, partitionArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { Schedule, ScheduleOverlapPolicy } from "@aikirun/types/schedule";
import {
	NON_TERMINAL_WORKFLOW_RUN_STATUSES,
	type WorkflowRunId,
	type WorkflowRunStateCancelled,
	type WorkflowRunStateQueued,
	type WorkflowStartOptions,
} from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { publishPendingOutboxEntries } from "./publish-ready-runs";
import type { Repositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRunRowInsert } from "../infra/db/types/workflow-run";
import type { WorkflowRunOutboxRowInsertPending } from "../infra/db/types/workflow-run-outbox";
import { computeRank } from "../lib/rank";
import { createTimerStreamCursorAdvancer } from "../lib/timer-stream";
import type { DaemonContext } from "../middleware/context";
import type { CancelledParentRun, ChildRunCanceller } from "../service/cancel-child-runs";
import { discardStaleTasks } from "../service/discard-stale-tasks";
import { getDueOccurrences, getNextOccurrence, getReferenceId, scheduleRowToDomain } from "../service/schedule";

export interface ProcessImminentRecurringWorkflowsDeps {
	repos: Pick<Repositories, "workflowRun" | "stateTransition" | "schedule" | "workflowRunOutbox" | "transaction">;
	childRunCanceller: ChildRunCanceller;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
}

export type DueSchedule = Schedule & {
	workflowId: string;
	namespaceId: NamespaceId;
	workflowRunInputHash: string;
};

const advanceScheduleCursor = createTimerStreamCursorAdvancer<{ schedule: { id: string; nextRunAt: TimestampMs } }>({
	getDueAt: (row) => row.schedule.nextRunAt,
	getId: (row) => row.schedule.id,
});

export async function processImminentRecurringWorkflows(
	context: DaemonContext,
	deps: ProcessImminentRecurringWorkflowsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 1_000, imminenceThresholdMs = 3_000 } = options ?? {};

	const dueBefore = (Date.now() + imminenceThresholdMs) as TimestampMs;

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
			workflowRunInputHash: schedule.workflowRunInputHash,
		}));

		const now = Date.now();
		const { whenTrue: schedulesDueNow, whenFalse: schedulesDueSoon } = partitionArray(schedules, (schedule) => ({
			meetsCondition: schedule.nextRunAt <= now,
			item: schedule,
		}));

		if (isNonEmptyArray(schedulesDueNow)) {
			await queueRecurringWorkflows(context, deps, schedulesDueNow);
		}

		const { timerPriorityQueue } = deps;
		if (timerPriorityQueue && isNonEmptyArray(schedulesDueSoon)) {
			const timers: TimerEntry[] = schedulesDueSoon.map((schedule) => ({
				type: "recurring",
				id: schedule.id,
				dueAt: schedule.nextRunAt,
				rank: computeRank(schedule.nextRunAt),
			}));
			const result = await timerPriorityQueue.add(timers as NonEmptyArray<TimerEntry>);
			if (result.status === "failed") {
				context.logger.debug("Failed to add timers to priority queue", { count: timers.length });
			}
		}
	}
}

export async function queueRecurringWorkflows(
	context: DaemonContext,
	deps: ProcessImminentRecurringWorkflowsDeps,
	schedules: NonEmptyArray<DueSchedule>
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
			? processOverlapAllowSchedules(context, deps.repos, allowSchedules, now, deps.workflowRunPublisher)
			: undefined,
		isNonEmptyArray(skipSchedules)
			? processOverlapSkipSchedules(context, deps.repos, skipSchedules, now, deps.workflowRunPublisher)
			: undefined,
		isNonEmptyArray(cancelPreviousSchedules)
			? processOverlapCancelPreviousSchedules(context, deps, cancelPreviousSchedules, now)
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
	repos: ProcessImminentRecurringWorkflowsDeps["repos"],
	schedules: NonEmptyArray<DueSchedule>,
	now: number,
	workflowRunPublisher?: Publisher
) {
	const workflowRunEntries: WorkflowRunRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const outboxEntries: WorkflowRunOutboxRowInsertPending[] = [];
	const scheduleUpdates: { id: string; lastOccurrence: TimestampMs; nextRunAt: TimestampMs }[] = [];

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
				input: schedule.input,
				inputHash: schedule.workflowRunInputHash,
				options: { reference: { id: referenceId } },
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
			outboxEntries.push({
				id: ulid(),
				namespaceId: schedule.namespaceId,
				workflowRunId: runId,
				workflowName: schedule.workflowName,
				workflowVersionId: schedule.workflowVersionId,
				rank: computeRank(occurrence),
				shard: null,
				status: "pending",
			});
		}

		// biome-ignore lint/style/noNonNullAssertion: isNonEmptyArray guarantees at least one element
		const lastOccurrence = occurrences.at(-1)!;
		scheduleUpdates.push({
			id: schedule.id,
			lastOccurrence: lastOccurrence as TimestampMs,
			nextRunAt: getNextOccurrence(schedule.spec, lastOccurrence) as TimestampMs,
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

	await repos.transaction(async (txRepos) => {
		await txRepos.workflowRun.insert(workflowRunEntries);
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		await txRepos.schedule.bulkUpdateOccurrence(scheduleUpdates);
		await txRepos.workflowRunOutbox.createBatch(outboxEntries);
	});

	if (workflowRunPublisher) {
		await publishPendingOutboxEntries(context, repos, workflowRunPublisher, outboxEntries);
	}
}

async function processOverlapSkipSchedules(
	context: DaemonContext,
	repos: ProcessImminentRecurringWorkflowsDeps["repos"],
	schedules: NonEmptyArray<DueSchedule>,
	now: number,
	workflowRunPublisher?: Publisher
) {
	const { activeRunsByScheduleId } = await fetchActiveRunsBySchedule(repos, schedules);

	const workflowRunEntries: WorkflowRunRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const outboxEntries: WorkflowRunOutboxRowInsertPending[] = [];
	const scheduleUpdates: { id: string; lastOccurrence?: TimestampMs; nextRunAt: TimestampMs }[] = [];

	for (const schedule of schedules) {
		const occurrences = getDueOccurrences(schedule, now);
		if (!isNonEmptyArray(occurrences)) {
			continue;
		}
		const occurrence = occurrences[0];

		if (activeRunsByScheduleId.has(schedule.id)) {
			scheduleUpdates.push({
				id: schedule.id,
				nextRunAt: getNextOccurrence(schedule.spec, occurrence) as TimestampMs,
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
			input: schedule.input,
			inputHash: schedule.workflowRunInputHash,
			options: { reference: { id: referenceId } },
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
		outboxEntries.push({
			id: ulid(),
			namespaceId: schedule.namespaceId,
			workflowRunId: runId,
			workflowName: schedule.workflowName,
			workflowVersionId: schedule.workflowVersionId,
			rank: computeRank(occurrence),
			shard: null,
			status: "pending",
		});
		scheduleUpdates.push({
			id: schedule.id,
			lastOccurrence: occurrence as TimestampMs,
			nextRunAt: getNextOccurrence(schedule.spec, occurrence) as TimestampMs,
		});
	}

	if (!isNonEmptyArray(scheduleUpdates)) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsertPending[] = await repos.transaction(async (txRepos) => {
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
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishPendingOutboxEntries(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}

async function processOverlapCancelPreviousSchedules(
	context: DaemonContext,
	deps: ProcessImminentRecurringWorkflowsDeps,
	schedules: NonEmptyArray<DueSchedule>,
	now: number
) {
	const { activeRunsByScheduleId } = await fetchActiveRunsBySchedule(deps.repos, schedules);

	const runIdsToCancel: string[] = [];
	const runsToCancel: Array<{ id: string; attempts: number; namespaceId: NamespaceId; shard?: string }> = [];

	const newWorkflowRunEntries: WorkflowRunRowInsert[] = [];
	const newRunStateTransitionEntries: StateTransitionRowInsert[] = [];
	const newOutboxEntries: WorkflowRunOutboxRowInsertPending[] = [];
	const scheduleUpdates: { id: string; lastOccurrence: TimestampMs; nextRunAt: TimestampMs }[] = [];

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
			input: schedule.input,
			inputHash: schedule.workflowRunInputHash,
			options: { reference: { id: referenceId } },
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
		newOutboxEntries.push({
			id: ulid(),
			namespaceId: schedule.namespaceId,
			workflowRunId: runId,
			workflowName: schedule.workflowName,
			workflowVersionId: schedule.workflowVersionId,
			rank: computeRank(occurrence),
			shard: null,
			status: "pending",
		});
		scheduleUpdates.push({
			id: schedule.id,
			lastOccurrence: occurrence as TimestampMs,
			nextRunAt: getNextOccurrence(schedule.spec, occurrence) as TimestampMs,
		});
	}

	if (
		!isNonEmptyArray(newWorkflowRunEntries) ||
		!isNonEmptyArray(newRunStateTransitionEntries) ||
		!isNonEmptyArray(scheduleUpdates)
	) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsertPending[] = await deps.repos.transaction(async (txRepos) => {
		// To escape the race condition that might arise when a concurrent actor moves the runId to non cancellable state,
		// we should only insert cancellation state transitions if the cancellation occurred, otherwise, we'll have dangling transitions

		// Step 1: Cancel active runs (without setting latestStateTransitionId)
		const cancelledRunIds = isNonEmptyArray(runIdsToCancel)
			? await txRepos.workflowRun.bulkTransitionToCancelled(runIdsToCancel)
			: [];

		// Step 2: Discard in-flight tasks and outbox entries for the cancelled runs, then insert
		// cancel state transitions only for actually cancelled runs and set latestStateTransitionId
		if (isNonEmptyArray(cancelledRunIds)) {
			await discardStaleTasks(cancelledRunIds, ["running", "awaiting_retry"], txRepos);
			await txRepos.workflowRunOutbox.deleteByWorkflowRunIds(cancelledRunIds);

			const cancelledRunIdsSet = new Set(cancelledRunIds);
			const cancelStateTransitionEntries: StateTransitionRowInsert[] = [];
			const cancelledRunStateTransitionIdUpdates: { id: string; stateTransitionId: string }[] = [];
			const cancelledRuns: CancelledParentRun[] = [];

			for (const run of runsToCancel) {
				if (!cancelledRunIdsSet.has(run.id)) {
					continue;
				}
				const stateTransitionId = ulid();
				cancelStateTransitionEntries.push({
					id: stateTransitionId,
					workflowRunId: run.id,
					type: "workflow_run",
					status: "cancelled",
					attempt: run.attempts,
					state: { status: "cancelled", reason: "Schedule overlap policy" } satisfies WorkflowRunStateCancelled,
				});
				cancelledRunStateTransitionIdUpdates.push({ id: run.id, stateTransitionId });
				cancelledRuns.push({ namespaceId: run.namespaceId, runId: run.id, shard: run.shard });
			}

			if (isNonEmptyArray(cancelStateTransitionEntries) && isNonEmptyArray(cancelledRunStateTransitionIdUpdates)) {
				await txRepos.stateTransition.appendBatch(cancelStateTransitionEntries);
				await txRepos.workflowRun.bulkSetLatestStateTransitionId(cancelledRunStateTransitionIdUpdates);
			}
			if (isNonEmptyArray(cancelledRuns)) {
				await deps.childRunCanceller.cancel(cancelledRuns, txRepos, context.logger);
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
	});

	if (deps.workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishPendingOutboxEntries(context, deps.repos, deps.workflowRunPublisher, insertedOutboxEntries);
	}
}

async function fetchActiveRunsBySchedule(
	repos: ProcessImminentRecurringWorkflowsDeps["repos"],
	schedules: NonEmptyArray<DueSchedule>
) {
	const workflowAndReferenceIdPairs: { workflowId: string; referenceId: string }[] = [];
	const schedulesByWorkflowAndReferenceId = new Map<string, Map<string, DueSchedule>>();

	for (const schedule of schedules) {
		if (schedule.lastOccurrence === undefined) {
			continue;
		}
		const referenceId = getReferenceId(schedule.id, schedule.lastOccurrence);
		workflowAndReferenceIdPairs.push({ workflowId: schedule.workflowId, referenceId });

		let schedulesByReferenceId = schedulesByWorkflowAndReferenceId.get(schedule.workflowId);
		if (!schedulesByReferenceId) {
			schedulesByReferenceId = new Map();
			schedulesByWorkflowAndReferenceId.set(schedule.workflowId, schedulesByReferenceId);
		}
		schedulesByReferenceId.set(referenceId, schedule);
	}

	const activeRunsByScheduleId = new Map<string, { id: string; attempts: number; shard?: string }>();

	if (isNonEmptyArray(workflowAndReferenceIdPairs) && isNonEmptyArray(NON_TERMINAL_WORKFLOW_RUN_STATUSES)) {
		const activeRuns = await repos.workflowRun.listByWorkflowAndReferenceIdPairs({
			pairs: workflowAndReferenceIdPairs,
			status: NON_TERMINAL_WORKFLOW_RUN_STATUSES,
		});

		for (const run of activeRuns) {
			if (run.referenceId) {
				const schedule = schedulesByWorkflowAndReferenceId.get(run.workflowId)?.get(run.referenceId);
				if (schedule) {
					const shard = (run.options as WorkflowStartOptions | null)?.shard;
					activeRunsByScheduleId.set(schedule.id, { id: run.id, attempts: run.attempts, shard });
				}
			}
		}
	}

	return { activeRunsByScheduleId };
}
