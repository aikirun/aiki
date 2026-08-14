import type { RetryStrategy } from "@aikirun/lib/retry";
import type { SerializableError } from "@aikirun/lib/serializable";

export type TaskId = string & { _brand: "task_id" };

export type TaskName = string & { _brand: "task_name" };

export type TaskAddress = string & { _brand: "task_address" };

export const TASK_STATUSES = ["running", "awaiting_retry", "completed", "failed", "discarded"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskStartOptions {
	retry?: RetryStrategy;
}

interface TaskStateBase {
	status: TaskStatus;
	attempts: number;
}

export interface TaskStateRunning extends TaskStateBase {
	status: "running";
}

export interface TaskStateAwaitingRetry extends TaskStateBase {
	status: "awaiting_retry";
	error: SerializableError;
	nextAttemptAt: number;
}

export interface TaskStateCompleted<Output> extends TaskStateBase {
	status: "completed";
	output: Output;
}

export interface TaskStateFailed extends TaskStateBase {
	status: "failed";
	error: SerializableError;
}

export interface TaskStateDiscarded extends TaskStateBase {
	status: "discarded";
}

export type TaskState<Output = unknown> =
	| TaskStateRunning
	| TaskStateAwaitingRetry
	| TaskStateCompleted<Output>
	| TaskStateFailed
	| TaskStateDiscarded;

export interface TaskInfo {
	id: string;
	name: string;
	state: Exclude<TaskState, TaskStateDiscarded>;
	inputHash: string;
}

export interface TaskRecord<Input = unknown, Output = unknown> {
	id: string;
	name: string;
	workflowRunId: string;
	input?: Input;
	inputHash: string;
	options?: TaskStartOptions;
	state: TaskState<Output>;
}
