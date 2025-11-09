import type { SerializableError } from "@aiki/lib/error";

export type TaskName = string & { _brand: "task_name" };

export type TaskStatus = "none" | "running" | "completed" | "failed";

interface TaskStateBase {
	status: TaskStatus;
}

export interface TaskStateNone extends TaskStateBase {
	status: "none";
}

export interface TaskStateRunning extends TaskStateBase {
	status: "running";
	attempts: number;
}

export interface TaskStateCompleted<Output> extends TaskStateBase {
	status: "completed";
	output: Output;
}

export interface TaskStateFailed extends TaskStateBase {
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

export class TaskFailedError extends Error {
	constructor(
		public readonly taskName: TaskName,
		public readonly attempts: number,
		public readonly reason: string,
	) {
		super(`Task ${taskName} failed after ${attempts} attempts. Reason: ${reason}`);
		this.name = "TaskFailedError";
	}
}
