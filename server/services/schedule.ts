import type { Schedule, ScheduleId, ScheduleSpec } from "@aikirun/types/schedule";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import { isTerminalWorkflowRunStatus, type WorkflowRun } from "@aikirun/types/workflow-run";
import CronExpressionParser from "cron-parser";
import { NotFoundError } from "server/errors";
import {
	schedulesById,
	workflowRunsById,
	workflowRunsByReferenceId,
} from "server/infrastructure/persistence/in-memory-store";

export function getScheduleKey(workflowName: string, workflowVersionId: string, scheduleName: string): string {
	return `${scheduleName}/${workflowName}/${workflowVersionId}`;
}

export function getReferenceId(scheduleId: string, occurrence: number) {
	return `schedule:${scheduleId}:${occurrence}`;
}

export function getDueSchedules(now: number): Schedule[] {
	const schedules: Schedule[] = [];
	for (const { schedule } of schedulesById.values()) {
		if (schedule.status === "active" && schedule.nextRunAt && schedule.nextRunAt <= now) {
			schedules.push(schedule);
		}
	}
	return schedules;
}

/**
 * Computes all occurrences that are due between `anchor` and `now` (inclusive).
 * Used for catchup policy.
 */
function getAllOccurrencesBetween(spec: ScheduleSpec, anchor: number, now: number): number[] {
	const occurrences: number[] = [];

	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(anchor),
			tz: spec.timezone,
		});

		while (true) {
			const next = parsed.next().getTime();
			if (next > now) {
				break;
			}
			occurrences.push(next);
		}
	} else {
		let cursor = anchor + spec.everyMs;
		while (cursor <= now) {
			occurrences.push(cursor);
			cursor += spec.everyMs;
		}
	}

	return occurrences;
}

/**
 * Computes the last occurrence that should have fired before or at `now` timestamp,
 * but after the `anchor` timestamp. Returns undefined if no occurrence exists in that range.
 */
function getLastOccurrenceBetween(spec: ScheduleSpec, anchor: number, now: number): number | undefined {
	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(now),
			tz: spec.timezone,
		});
		const previous = parsed.prev().getTime();
		return previous > anchor ? previous : undefined;
	}

	const elapsed = now - anchor;
	if (elapsed < spec.everyMs) {
		return undefined;
	}
	const intervalsPassed = Math.floor(elapsed / spec.everyMs);
	return anchor + intervalsPassed * spec.everyMs;
}

export function getDueOccurrences(schedule: Schedule, now: number): number[] {
	const { spec } = schedule;
	const anchor = schedule.lastOccurrence ?? schedule.createdAt;
	const overlapPolicy = spec.overlapPolicy ?? "skip";

	if (overlapPolicy === "allow") {
		return getAllOccurrencesBetween(spec, anchor, now);
	}

	const lastDue = getLastOccurrenceBetween(spec, anchor, now);
	return lastDue !== undefined ? [lastDue] : [];
}

export function getNextOccurrence(spec: ScheduleSpec, anchor: number): number {
	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(anchor),
			tz: spec.timezone,
		});
		return parsed.next().getTime();
	}

	return anchor + spec.everyMs;
}

export function findActiveRunForSchedule(schedule: Schedule): WorkflowRun | undefined {
	if (schedule.lastOccurrence === undefined) {
		return undefined;
	}

	const referenceId = getReferenceId(schedule.id, schedule.lastOccurrence);
	const runId = workflowRunsByReferenceId
		.get(schedule.workflowName as WorkflowName)
		?.get(schedule.workflowVersionId as WorkflowVersionId)
		?.get(referenceId);
	if (!runId) {
		return undefined;
	}

	const run = workflowRunsById.get(runId);
	if (!run) {
		return undefined;
	}

	return isTerminalWorkflowRunStatus(run.state.status) ? undefined : run;
}

export function updateSchedule(id: string, updates: Partial<Schedule>): Schedule {
	const scheduleId = id as ScheduleId;
	const scheduleInfo = schedulesById.get(scheduleId);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${id}`);
	}
	const updatedSchedule = { ...scheduleInfo.schedule, ...updates };
	schedulesById.set(scheduleId, { schedule: updatedSchedule, definitionHash: scheduleInfo.definitionHash });
	return updatedSchedule;
}
