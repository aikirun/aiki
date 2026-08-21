import type { DistributiveOmit, OptionalProp } from "@aikirun/lib/object";

import type { ClientCodec } from "../workflow";
import type {
	TaskInfo,
	TaskRecord,
	TaskStartOptions,
	TaskStateAwaitingRetry,
	TaskStateCompleted,
	TaskStateFailed,
	TaskStateRunning,
} from "../workflow/task";

export interface TaskApi {
	getByIdV1: (_: TaskGetByIdRequestV1) => Promise<TaskGetByIdResponseV1>;
	transitionStateV1: (_: TaskTransitionStateRequestV1) => Promise<TaskTransitionStateResponseV1>;
	setStateV1: (_: TaskSetStateRequestV1) => Promise<void>;
}

export interface TaskGetByIdRequestV1 {
	id: string;
}

export interface TaskGetByIdResponseV1 {
	task: TaskRecord;
}

export interface TransitionTaskStateBase {
	workflowRunId: string;
	expectedWorkflowRunRevision: number;
}

export interface TransitionTaskStateToRunningCreate extends TransitionTaskStateBase {
	type: "create";
	taskName: string;
	options?: TaskStartOptions;
	input?: unknown;
	inputHash: string;
	clientCodec: ClientCodec;
}

export interface TransitionTaskStateToRunningRetry extends TransitionTaskStateBase {
	type: "retry";
	id: string;
	options?: TaskStartOptions;
	taskState: TaskStateRunning;
}

export type TransitionTaskStateToRunning = TransitionTaskStateToRunningCreate | TransitionTaskStateToRunningRetry;

export interface TransitionTaskStateToCompleted extends TransitionTaskStateBase {
	id: string;
	taskState: TaskStateCompletedRequest;
}

export type TaskStateCompletedRequest = OptionalProp<TaskStateCompleted<unknown>, "output">;

export interface TransitionTaskStateToFailed extends TransitionTaskStateBase {
	id: string;
	taskState: TaskStateFailed;
}

export interface TransitionTaskStateToAwaitingRetry extends TransitionTaskStateBase {
	id: string;
	taskState: TaskStateAwaitingRetryRequest;
}

export type TaskStateAwaitingRetryRequest = Omit<TaskStateAwaitingRetry, "nextAttemptAt"> & {
	nextAttemptInMs: number;
};

export type TaskTransitionStateRequestV1 =
	| TransitionTaskStateToRunning
	| TransitionTaskStateToCompleted
	| TransitionTaskStateToFailed
	| TransitionTaskStateToAwaitingRetry;

export interface TaskTransitionStateResponseV1 {
	taskInfo: TaskInfo;
}

export interface TaskSetStateRequestNew {
	type: "new";
	workflowRunId: string;
	taskName: string;
	input?: unknown;
	inputHash: string;
	state: DistributiveOmit<TaskStateCompleted<unknown> | TaskStateFailed, "attempts">;
}

export interface TaskSetStateRequestExisting {
	type: "existing";
	id: string;
	workflowRunId: string;
	state: DistributiveOmit<TaskStateCompleted<unknown> | TaskStateFailed, "attempts">;
}

export type TaskSetStateRequestV1 = TaskSetStateRequestNew | TaskSetStateRequestExisting;
