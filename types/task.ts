import type { RetryStrategy } from "./retry";
import type { SerializableError } from "./serializable";
import type { OptionalProp } from "./utils";

export type TaskId = string & { _brand: "task_id" };

export type TaskName = string & { _brand: "task_name" };

export type TaskPath = string & { _brand: "task_path" };

export type TaskStatus = "running" | "awaiting_retry" | "completed" | "failed";

export interface TaskOptions {
	retry?: RetryStrategy;
	reference?: TaskReferenceOptions;
}

export interface TaskReferenceOptions {
	id: string;
	conflictPolicy?: "error" | "return_existing";
}

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
	id: string;
	name: string;
	state: TaskState;
	inputHash: string;
}

export interface TransitionTaskStateBase {
	id: string;
	expectedRevision: number;
}

export interface TransitionTaskStateToRunningCreate extends TransitionTaskStateBase {
	type: "create";
	taskName: string;
	options?: TaskOptions;
	taskState: TaskStateRunningRequest;
}

export interface TransitionTaskStateToRunningRetry extends TransitionTaskStateBase {
	type: "retry";
	taskId: string;
	options?: TaskOptions;
	taskState: TaskStateRunningRequest;
}

export type TaskStateRunningRequest = OptionalProp<TaskStateRunning<unknown>, "input">;

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

export class TaskFailedError extends Error {
	public readonly taskId: TaskId;
	public readonly attempts: number;
	public readonly reason: string;

	constructor(taskId: TaskId, attempts: number, reason: string) {
		super(`Task ${taskId} failed after ${attempts} attempts. Reason: ${reason}`);
		this.name = "TaskFailedError";
		this.taskId = taskId;
		this.attempts = attempts;
		this.reason = reason;
	}
}
