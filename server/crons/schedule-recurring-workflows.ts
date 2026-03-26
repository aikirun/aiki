import { isNonEmptyArray } from "@aikirun/lib";
import type { NonEmptyArray } from "@aikirun/lib/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { Schedule, ScheduleOverlapPolicy } from "@aikirun/types/schedule";
import {
	NON_TERMINAL_WORKFLOW_RUN_STATUSES,
	type WorkflowRunId,
	type WorkflowRunStateCancelled,
	type WorkflowRunStateScheduled,
	type WorkflowStartOptions,
} from "@aikirun/types/workflow-run";
import type { Repositories, StateTransitionRowInsert, WorkflowRunRowInsert } from "server/infra/db/types";
import type { CronContext } from "server/middleware/context";
import type { CancelledParentRun, ChildRunCanceller } from "server/service/cancel-child-runs";
import type { ScheduleService } from "server/service/schedule";
import { getDueOccurrences, getNextOccurrence, getReferenceId } from "server/service/schedule";
import { ulid } from "ulidx";

export interface ScheduleRecurringWorkflowsDeps {
	repos: Pick<Repositories, "workflowRun" | "stateTransition" | "schedule" | "transaction">;
	scheduleService: ScheduleService;
	childRunCanceller: ChildRunCanceller;
}

type DueSchedule = Schedule & {
	workflowId: string;
	namespaceId: NamespaceId;
	workflowRunInputHash: string;
};

export async function scheduleRecurringWorkflows(context: CronContext, deps: ScheduleRecurringWorkflowsDeps) {
	const now = Date.now();

	const dueSchedules = await deps.scheduleService.getDueSchedules(now);
	if (!isNonEmptyArray(dueSchedules)) {
		return;
	}

	const allowSchedules: DueSchedule[] = [];
	const skipSchedules: DueSchedule[] = [];
	const cancelPreviousSchedules: DueSchedule[] = [];

	for (const schedule of dueSchedules) {
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
			? processOverlapAllowSchedules(context, deps.repos, allowSchedules, now)
			: undefined,
		isNonEmptyArray(skipSchedules) ? processOverlapSkipSchedules(context, deps.repos, skipSchedules, now) : undefined,
		isNonEmptyArray(cancelPreviousSchedules)
			? processOverlapCancelPreviousSchedules(context, deps, cancelPreviousSchedules, now)
			: undefined,
	]);

	for (const result of results) {
		if (result.status === "rejected") {
			context.logger.warn({ err: result.reason }, "Failed to process recurring schedules batch, will retry next tick");
		}
	}
}

async function processOverlapAllowSchedules(
	_context: CronContext,
	repos: ScheduleRecurringWorkflowsDeps["repos"],
	schedules: NonEmptyArray<DueSchedule>,
	now: number
) {
	const workflowRunEntries: WorkflowRunRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
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
				status: "scheduled",
				input: schedule.input,
				inputHash: schedule.workflowRunInputHash,
				options: { reference: { id: referenceId } },
				referenceId,
				latestStateTransitionId: stateTransitionId,
				scheduledAt: new Date(now),
			});
			stateTransitionEntries.push({
				id: stateTransitionId,
				workflowRunId: runId,
				type: "workflow_run",
				status: "scheduled",
				attempt: 0,
				state: { status: "scheduled", scheduledAt: now, reason: "new" } satisfies WorkflowRunStateScheduled,
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

	await repos.transaction(async (txRepos) => {
		await txRepos.workflowRun.insert(workflowRunEntries);
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		await txRepos.schedule.bulkUpdateOccurrence(scheduleUpdates);
	});
}

async function processOverlapSkipSchedules(
	_context: CronContext,
	repos: ScheduleRecurringWorkflowsDeps["repos"],
	schedules: NonEmptyArray<DueSchedule>,
	now: number
) {
	const { scheduleIdsWithActiveRuns } = await fetchActiveRunsBySchedule(repos, schedules);

	const workflowRunEntries: WorkflowRunRowInsert[] = [];
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
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
			status: "scheduled",
			input: schedule.input,
			inputHash: schedule.workflowRunInputHash,
			options: { reference: { id: referenceId } },
			referenceId,
			latestStateTransitionId: stateTransitionId,
			scheduledAt: new Date(now),
		});
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: runId,
			type: "workflow_run",
			status: "scheduled",
			attempt: 0,
			state: { status: "scheduled", scheduledAt: now, reason: "new" } satisfies WorkflowRunStateScheduled,
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

	await repos.transaction(async (txRepos) => {
		if (isNonEmptyArray(workflowRunEntries) && isNonEmptyArray(stateTransitionEntries)) {
			await txRepos.workflowRun.insert(workflowRunEntries);
			await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		}
		await txRepos.schedule.bulkUpdateOccurrence(scheduleUpdates);
	});
}

async function processOverlapCancelPreviousSchedules(
	context: CronContext,
	deps: ScheduleRecurringWorkflowsDeps,
	schedules: NonEmptyArray<DueSchedule>,
	now: number
) {
	const { activeRunsByScheduleId } = await fetchActiveRunsBySchedule(deps.repos, schedules);

	const runIdsToCancel: string[] = [];
	const runsToCancel: Array<{ id: string; attempts: number; namespaceId: NamespaceId; shard?: string }> = [];

	const newWorkflowRunEntries: WorkflowRunRowInsert[] = [];
	const newRunStateTransitionEntries: StateTransitionRowInsert[] = [];
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
			status: "scheduled",
			input: schedule.input,
			inputHash: schedule.workflowRunInputHash,
			options: { reference: { id: referenceId } },
			referenceId,
			latestStateTransitionId: stateTransitionId,
			scheduledAt: new Date(now),
		});
		newRunStateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: runId,
			type: "workflow_run",
			status: "scheduled",
			attempt: 0,
			state: { status: "scheduled", scheduledAt: now, reason: "new" } satisfies WorkflowRunStateScheduled,
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

	await deps.repos.transaction(async (txRepos) => {
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
			const cancelledParentRuns: CancelledParentRun[] = [];

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
				cancelledParentRuns.push({ namespaceId: run.namespaceId, runId: run.id, shard: run.shard });
			}

			if (isNonEmptyArray(cancelStateTransitionEntries) && isNonEmptyArray(cancelledRunStateTransitionIdUpdates)) {
				await txRepos.stateTransition.appendBatch(cancelStateTransitionEntries);
				await txRepos.workflowRun.bulkSetLatestStateTransitionId(cancelledRunStateTransitionIdUpdates);
			}
			if (isNonEmptyArray(cancelledParentRuns)) {
				await deps.childRunCanceller.cancel(cancelledParentRuns, txRepos, context.logger);
			}
		}

		// Step 3: Create new workflow runs and their state transitions
		await txRepos.workflowRun.insert(newWorkflowRunEntries);
		await txRepos.stateTransition.appendBatch(newRunStateTransitionEntries);
		await txRepos.schedule.bulkUpdateOccurrence(scheduleUpdates);
	});
}

async function fetchActiveRunsBySchedule(
	repos: ScheduleRecurringWorkflowsDeps["repos"],
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
