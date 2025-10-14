import type { SerializableError } from "./serializable.ts";

export type TaskName = string & { _brand: "task_name" };

export interface TaskStateNone {
	state: "none";
}

export interface TaskStateInProgress {
	state: "in_progress";
	attempts: number;
}

export interface TaskStateCompleted<Output> {
	state: "completed";
	output: Output;
}

export interface TaskStateFailed {
	state: "failed";
	reason: string;
	attempts: number;
	attemptedAt: number;
	nextAttemptAt?: number;
	error?: SerializableError;
}

export type TaskState<Output> =
	| TaskStateNone
	| TaskStateInProgress
	| TaskStateCompleted<Output>
	| TaskStateFailed;
