export type ScheduleId = string & { _brand: "schedule_id" };

export const SCHEDULE_STATUSES = ["active", "paused", "deleted"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_TYPES = ["cron", "interval"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const SCHEDULE_OVERLAP_POLICIES = ["allow", "skip", "cancel_previous"] as const;
export type ScheduleOverlapPolicy = (typeof SCHEDULE_OVERLAP_POLICIES)[number];

interface ScheduleSpecBase {
	type: ScheduleType;
	overlapPolicy?: ScheduleOverlapPolicy;
}

export interface CronScheduleSpec extends ScheduleSpecBase {
	type: "cron";
	expression: string;
	timezone?: string;
}

export interface IntervalScheduleSpec extends ScheduleSpecBase {
	type: "interval";
	everyMs: number;
}

export type ScheduleSpec = CronScheduleSpec | IntervalScheduleSpec;

export const SCHEDULE_CONFLICT_POLICIES = ["upsert", "error"] as const;
export type ScheduleConflictPolicy = (typeof SCHEDULE_CONFLICT_POLICIES)[number];

export interface ScheduleReferenceOptions {
	id: string;
	conflictPolicy?: ScheduleConflictPolicy;
}

export interface ScheduleActivateOptions {
	reference?: ScheduleReferenceOptions;
}

export interface Schedule {
	id: string;
	workflowName: string;
	workflowVersionId: string;
	status: ScheduleStatus;
	spec: ScheduleSpec;
	input?: unknown;
	options?: ScheduleActivateOptions;
	createdAt: number;
	updatedAt: number;
	lastOccurrence?: number;
	nextRunAt: number;
	runCount: number;
}
