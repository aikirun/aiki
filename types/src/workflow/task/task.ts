import type { OptionalProp } from "@aikirun/lib/object";
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

export interface TransitionTaskStateBase {
	id: string;
	expectedWorkflowRunRevision: number;
}

export interface TransitionTaskStateToRunningCreate extends TransitionTaskStateBase {
	type: "create";
	taskName: string;
	options?: TaskStartOptions;
	input?: unknown;
	taskState: Omit<TaskStateRunning, "attempts">;
}

export interface TransitionTaskStateToRunningRetry extends TransitionTaskStateBase {
	type: "retry";
	taskId: string;
	options?: TaskStartOptions;
	taskState: TaskStateRunning;
}

export interface TransitionTaskStateToCompleted extends TransitionTaskStateBase {
	taskId: string;
	taskState: TaskStateCompletedRequest;
}

export type TaskStateCompletedRequest = OptionalProp<TaskStateCompleted<unknown>, "output">;

export interface TransitionTaskStateToFailed extends TransitionTaskStateBase {
	taskId: string;
	taskState: TaskStateFailed;
}

export interface TransitionTaskStateToAwaitingRetry extends TransitionTaskStateBase {
	taskId: string;
	taskState: TaskStateAwaitingRetryRequest;
}

export type TaskStateAwaitingRetryRequest = Omit<TaskStateAwaitingRetry, "nextAttemptAt"> & {
	nextAttemptInMs: number;
};
