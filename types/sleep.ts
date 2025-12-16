import type { DurationObject } from "./duration";

export type SleepId = string & { _brand: "sleep_id" };

export type SleepStatus = "none" | "sleeping" | "completed";

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

export type SleepState = SleepStateNone | SleepStateSleeping | SleepStateCompleted;

export type SleepParams = { id: string } & DurationObject;
