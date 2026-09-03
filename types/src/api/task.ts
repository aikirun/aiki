import type { OpaquePayload } from "../payload";
import type {
	TaskInfo,
	TaskRecord,
	TaskStartOptions,
	TaskStateAwaitingRetry,
	TaskStateCompleted,
	TaskStateFailed,
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
	input?: OpaquePayload;
	inputHash: string;
}

export interface TransitionTaskStateToRunningRetry extends TransitionTaskStateBase {
	type: "retry";
	id: string;
	attempts: number;
}

export type TransitionTaskStateToRunning = TransitionTaskStateToRunningCreate | TransitionTaskStateToRunningRetry;

export interface TransitionTaskStateToCompleted extends TransitionTaskStateBase {
	id: string;
	attempts: number;
	state: TaskStateCompletedRequest;
}

export type TaskStateCompletedRequest = TaskStateCompleted;

export interface TransitionTaskStateToFailed extends TransitionTaskStateBase {
	id: string;
	attempts: number;
	state: TaskStateFailed;
}

export interface TransitionTaskStateToAwaitingRetry extends TransitionTaskStateBase {
	id: string;
	attempts: number;
	state: TaskStateAwaitingRetryRequest;
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

export interface TaskSetStateRequestV1 {
	id: string;
	workflowRunId: string;
	state: TaskStateCompleted | TaskStateFailed;
}
