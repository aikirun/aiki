import type { SerializableError } from "./error";

export type TaskId = string & { _brand: "task_id" };

export type TaskPath = string & { _brand: "task_path" };

export type TaskStatus = "running" | "awaiting_retry" | "completed" | "failed";

interface TaskStateBase {
	status: TaskStatus;
}

export interface TaskStateRunning<Input> extends TaskStateBase {
	status: "running";
	attempts: number;
	input: Input;
}

export interface TaskStateAwaitingRetry extends TaskStateBase {
	status: "awaiting_retry";
	attempts: number;
	error: SerializableError;
	nextAttemptAt: number;
}

export interface TaskStateCompleted<Output> extends TaskStateBase {
	status: "completed";
	attempts: number;
	output: Output;
}

export interface TaskStateFailed extends TaskStateBase {
	status: "failed";
	attempts: number;
	error: SerializableError;
}

export type TaskState<Input = unknown, Output = unknown> =
	| TaskStateRunning<Input>
	| TaskStateAwaitingRetry
	| TaskStateCompleted<Output>
	| TaskStateFailed;

export interface TaskInfo {
	state: TaskState;
	inputHash: string;
}

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
