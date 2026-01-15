export type ScheduleId = string & { _brand: "schedule_id" };
export type ScheduleName = string & { _brand: "schedule_name" };

export type OverlapPolicy = "allow" | "skip" | "cancel_previous";

export interface CronScheduleSpec {
	type: "cron";
	expression: string;
	timezone?: string;
	overlapPolicy?: OverlapPolicy;
}

export interface IntervalScheduleSpec {
	type: "interval";
	everyMs: number;
	overlapPolicy?: OverlapPolicy;
}

export type ScheduleSpec = CronScheduleSpec | IntervalScheduleSpec;

export type ScheduleStatus = "active" | "paused" | "deleted";

export interface Schedule {
	id: string;
	name: string;
	workflowName: string;
	workflowVersionId: string;
	input?: unknown;
	spec: ScheduleSpec;
	status: ScheduleStatus;
	createdAt: number;
	updatedAt: number;
	lastOccurrence?: number;
	nextRunAt: number;
	runCount: number;
}
