import type { SerializableError } from "./error";

export type TaskId = string & { _brand: "task_id" };

export type TaskPath = string & { _brand: "task_path" };

export type TaskStatus = "none" | "running" | "completed" | "failed";

interface TaskStateBase {
	status: TaskStatus;
}

export interface TaskStateNone extends TaskStateBase {
	status: "none";
}

// TODO: add input to this interface, so we can track what the input was to a task
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

export type TaskState<Output> = TaskStateNone | TaskStateRunning | TaskStateCompleted<Output> | TaskStateFailed;

export class TaskFailedError extends Error {
	constructor(
		public readonly taskPath: TaskPath,
		public readonly attempts: number,
		public readonly reason: string
	) {
		super(`Task ${taskPath} failed after ${attempts} attempts. Reason: ${reason}`);
		this.name = "TaskFailedError";
	}
}
