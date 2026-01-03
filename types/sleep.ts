import type { DurationObject } from "./duration";

export type SleepId = string & { _brand: "sleep_id" };

export type SleepStatus = "sleeping" | "completed" | "cancelled";

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

export type SleepParams = { id: string } & DurationObject;

export interface SleepResult {
	cancelled: boolean;
}
