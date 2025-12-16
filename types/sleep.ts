import type { DurationObject } from "./duration";

export type SleepId = string & { _brand: "sleep_id" };

export type SleepStatus = "none" | "sleeping" | "completed" | "cancelled";

interface SleepStateBase {
	status: SleepStatus;
}

export interface SleepStateNone extends SleepStateBase {
	status: "none";
}

export interface SleepStateSleeping extends SleepStateBase {
	status: "sleeping";
	awakeAt: number;
}

export interface SleepStateCompleted extends SleepStateBase {
	status: "completed";
	completedAt: number;
}

export interface SleepStateCancelled extends SleepStateBase {
	status: "cancelled";
	cancelledAt: number;
}

export type SleepState = SleepStateNone | SleepStateSleeping | SleepStateCompleted | SleepStateCancelled;

export type SleepParams = { id: string } & DurationObject;

export interface SleepResult {
	cancelled: boolean;
}
