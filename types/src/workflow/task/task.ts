import type { RetryStrategy } from "@aikirun/lib/retry";
import type { SerializableError } from "@aikirun/lib/serializable";

import type { OpaquePayload } from "../../payload";

export type TaskId = string & { _brand: "task_id" };

export type TaskName = string & { _brand: "task_name" };

export type TaskAddress = string & { _brand: "task_address" };

export const TASK_STATUSES = ["running", "awaiting_retry", "completed", "failed", "discarded"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type DiscardableTaskStatus = "running" | "awaiting_retry" | "failed";

export interface TaskStartOptions {
	retry?: RetryStrategy;
}

export interface TaskStateRunning {
	status: "running";
}

export interface TaskStateAwaitingRetry {
	status: "awaiting_retry";
	error: SerializableError;
	nextAttemptAt: number;
}

export interface TaskStateCompleted {
	status: "completed";
	output?: OpaquePayload;
}

export interface TaskStateFailed {
	status: "failed";
	error: SerializableError;
}

export interface TaskStateDiscarded {
	status: "discarded";
}

export type TaskState =
	| TaskStateRunning
	| TaskStateAwaitingRetry
	| TaskStateCompleted
	| TaskStateFailed
	| TaskStateDiscarded;

export interface TaskInfo {
	id: string;
	name: string;
	inputHash: string;
	options?: TaskStartOptions;
	attempts: number;
	state: Exclude<TaskState, TaskStateDiscarded>;
}

export interface TaskRecord {
	id: string;
	name: string;
	workflowRunId: string;
	input?: OpaquePayload;
	inputHash: string;
	options?: TaskStartOptions;
	attempts: number;
	state: TaskState;
}
