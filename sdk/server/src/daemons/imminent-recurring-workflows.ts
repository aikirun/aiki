import type { NonEmptyArray } from "@aikirun/lib/array";
import { isNonEmptyArray, partitionArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerEntry, TimerSortedSet } from "@aikirun/types/infra/timer";
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

import { publishRuns } from "./publish-ready-runs";
import type { Repositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRunRowInsert } from "../infra/db/types/workflow-run";
import type { WorkflowRunOutboxRowInsert } from "../infra/db/types/workflow-run-outbox";
import { computeRank } from "../lib/rank";
import { createTimerStreamCursorAdvancer } from "../lib/timer-stream";
import type { DaemonContext } from "../middleware/context";
import type { CancelledParentRun, ChildRunCanceller } from "../service/cancel-child-runs";
import { getDueOccurrences, getNextOccurrence, getReferenceId, scheduleRowToDomain } from "../service/schedule";

export interface ProcessImminentRecurringWorkflowsDeps {
	repos: Pick<Repositories, "workflowRun" | "stateTransition" | "schedule" | "workflowRunOutbox" | "transaction">;
	childRunCanceller: ChildRunCanceller;
	workflowRunPublisher?: Publisher;
	timerSortedSet?: TimerSortedSet;
}

export type DueSchedule = Schedule & {
	workflowId: string;
	namespaceId: NamespaceId;
	workflowRunInputHash: string;
};

const advanceScheduleCursor = createTimerStreamCursorAdvancer<{ schedule: { id: string; nextRunAt: Date } }>({
	getDueAt: (row) => row.schedule.nextRunAt,
	getId: (row) => row.schedule.id,
});

export async function processImminentRecurringWorkflows(
	context: DaemonContext,
	deps: ProcessImminentRecurringWorkflowsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 1_000, imminenceThresholdMs = 3_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);

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
		const { whenTrue: schedulesDueNow, whenFalse: schedulesDueSoon } = partitionArray(schedules, (schedule) => {
			if (schedule.nextRunAt > now) {
				return { meetsCondition: false, item: schedule };
			}
			return { meetsCondition: true, item: schedule };
		});

		if (isNonEmptyArray(schedulesDueNow)) {
			await queueRecurringWorkflows(context, deps, schedulesDueNow);
		}

		const { timerSortedSet } = deps;
		if (timerSortedSet && isNonEmptyArray(schedulesDueSoon)) {
			const timers: TimerEntry[] = schedulesDueSoon.map((schedule) => ({
				type: "recurring",
				id: schedule.id,
				dueAt: schedule.nextRunAt,
				rank: computeRank(schedule.nextRunAt),
			}));
			await timerSortedSet.add(timers as NonEmptyArray<TimerEntry>);
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
	const outboxEntries: WorkflowRunOutboxRowInsert[] = [];
	const scheduleUpdates: { id: string; lastOccurrence: Date; nextRunAt: Date }[] = [];

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
		const lastOccurrence = occurrences[occurrences.length - 1]!;
		scheduleUpdates.push({
			id: schedule.id,
			lastOccurrence: new Date(lastOccurrence),
			nextRunAt: new Date(getNextOccurrence(schedule.spec, lastOccurrence)),
		});
	}

	if (
		!isNonEmptyArray(workflowRunEntries) ||
		!isNonEmptyArray(stateTransitionEntries) ||
		!isNonEmptyArray(scheduleUpdates)
	) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await repos.transaction(async (txRepos) => {
		await txRepos.workflowRun.insert(workflowRunEntries);
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		await txRepos.schedule.bulkUpdateOccurrence(scheduleUpdates);
		if (!isNonEmptyArray(outboxEntries)) {
			return [];
		}
		await txRepos.workflowRunOutbox.createBatch(outboxEntries);
		return outboxEntries;
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishRuns(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}

async function processOverlapSkipSchedules(
	context: DaemonContext,
	repos: ProcessImminentRecurringWorkflowsDeps["repos"],
	schedules: NonEmptyArray<DueSchedule>,
	now: number,
	workflowRunPublisher?: Publisher
) {
	const { scheduleIdsWithActiveRuns } = await fetchActiveRunsBySchedule(repos, schedules);

	const workflowRunEntries: WorkflowRunRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const outboxEntries: WorkflowRunOutboxRowInsert[] = [];
	const scheduleUpdates: { id: string; lastOccurrence?: Date; nextRunAt: Date }[] = [];

	for (const schedule of schedules) {
		const occurrences = getDueOccurrences(schedule, now);
		if (!isNonEmptyArray(occurrences)) {
			continue;
		}
		const occurrence = occurrences[0];

		if (scheduleIdsWithActiveRuns.has(schedule.id)) {
			scheduleUpdates.push({
				id: schedule.id,
				nextRunAt: new Date(getNextOccurrence(schedule.spec, occurrence)),
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
			lastOccurrence: new Date(occurrence),
			nextRunAt: new Date(getNextOccurrence(schedule.spec, occurrence)),
		});
	}

	if (!isNonEmptyArray(scheduleUpdates)) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await repos.transaction(async (txRepos) => {
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
		await publishRuns(context, repos, workflowRunPublisher, insertedOutboxEntries);
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
	const newOutboxEntries: WorkflowRunOutboxRowInsert[] = [];
	const scheduleUpdates: { id: string; lastOccurrence: Date; nextRunAt: Date }[] = [];

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
			lastOccurrence: new Date(occurrence),
			nextRunAt: new Date(getNextOccurrence(schedule.spec, occurrence)),
		});
	}

	if (
		!isNonEmptyArray(newWorkflowRunEntries) ||
		!isNonEmptyArray(newRunStateTransitionEntries) ||
		!isNonEmptyArray(scheduleUpdates)
	) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await deps.repos.transaction(async (txRepos) => {
		// To espace the race condition that might arise when a concurrent actor moves the runId to non cancellable state,
		// we should only insert cancellation state transistions if the cancellation occurred, otherwise, we'll have dangling transitions

		// Step 1: Cancel active runs (without setting latestStateTransitionId)
		const cancelledRunIds = isNonEmptyArray(runIdsToCancel)
			? await txRepos.workflowRun.bulkTransitionToCancelled(runIdsToCancel)
			: [];

		// Step 2: Insert cancel state transitions only for actually cancelled runs, then set latestStateTransitionId
		if (isNonEmptyArray(cancelledRunIds)) {
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
		await publishRuns(context, deps.repos, deps.workflowRunPublisher, insertedOutboxEntries);
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

	const scheduleIdsWithActiveRuns = new Set<string>();
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
					scheduleIdsWithActiveRuns.add(schedule.id);
					const shard = (run.options as WorkflowStartOptions | null)?.shard;
					activeRunsByScheduleId.set(schedule.id, { id: run.id, attempts: run.attempts, shard });
				}
			}
		}
	}

	return { scheduleIdsWithActiveRuns, activeRunsByScheduleId };
}
