import type { SerializableError } from "@aikirun/lib/error";

export type TaskId = string & { _brand: "task_id" };

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

export type TaskState<Output> = TaskStateNone | TaskStateRunning | TaskStateCompleted<Output> | TaskStateFailed;

// TODO: create Task interface. It should contain the input that was fed into the task

export class TaskFailedError extends Error {
	constructor(
		public readonly taskId: TaskId,
		public readonly attempts: number,
		public readonly reason: string
	) {
		super(`Task ${taskId} failed after ${attempts} attempts. Reason: ${reason}`);
		this.name = "TaskFailedError";
	}
}
