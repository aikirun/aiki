export type SleepName = string & { _brand: "sleep_name" };

export const SLEEP_STATUSES = ["sleeping", "completed", "cancelled"] as const;
export type SleepStatus = (typeof SLEEP_STATUSES)[number];

interface SleepBase {
	status: SleepStatus;
}

export interface SleepSleeping extends SleepBase {
	status: "sleeping";
	awakeAt: number;
}

export interface SleepCompleted extends SleepBase {
	status: "completed";
	durationMs: number;
	completedAt: number;
}

export interface SleepCancelled extends SleepBase {
	status: "cancelled";
	cancelledAt: number;
}

export type Sleep = SleepSleeping | SleepCompleted | SleepCancelled;

export interface SleepQueue {
	sleeps: Sleep[];
}

export interface SleepResult {
	cancelled: boolean;
}
