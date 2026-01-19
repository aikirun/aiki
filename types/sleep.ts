export type SleepName = string & { _brand: "sleep_name" };

export const SLEEP_STATUSES = ["sleeping", "completed", "cancelled"] as const;
export type SleepStatus = (typeof SLEEP_STATUSES)[number];

interface SleepStateBase {
	status: SleepStatus;
}

export interface SleepStateSleeping extends SleepStateBase {
	status: "sleeping";
	awakeAt: number;
}

export interface SleepStateCompleted extends SleepStateBase {
	status: "completed";
	durationMs: number;
	completedAt: number;
}

export interface SleepStateCancelled extends SleepStateBase {
	status: "cancelled";
	cancelledAt: number;
}

export type SleepState = SleepStateSleeping | SleepStateCompleted | SleepStateCancelled;

export interface SleepQueue {
	sleeps: SleepState[];
}

export interface SleepResult {
	cancelled: boolean;
}
