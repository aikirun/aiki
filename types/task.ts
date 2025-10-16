import type { SerializableError } from "./serializable.ts";

export type TaskName = string & { _brand: "task_name" };

export interface TaskStateNone {
	status: "none";
}

export interface TaskStateRunning {
	status: "running";
	attempts: number;
}

export interface TaskStateCompleted<Output> {
	status: "completed";
	output: Output;
}

export interface TaskStateFailed {
	status: "failed";
	reason: string;
	attempts: number;
	attemptedAt: number;
	nextAttemptAt?: number;
	error?: SerializableError;
}

export type TaskState<Output> =
	| TaskStateNone
	| TaskStateRunning
	| TaskStateCompleted<Output>
	| TaskStateFailed;
