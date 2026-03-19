import type { EventSendOptions } from "./event";
import type { StateTransition } from "./state-transition";
import type {
	TaskInfo,
	TaskStateCompleted,
	TaskStateFailed,
	TaskStatus,
	TransitionTaskStateToAwaitingRetry,
	TransitionTaskStateToCompleted,
	TransitionTaskStateToFailed,
	TransitionTaskStateToRunningCreate,
	TransitionTaskStateToRunningRetry,
} from "./task";
import type { DistributiveOmit, OptionalProp } from "./utils";
import type { WorkflowSource } from "./workflow";
import type {
	WorkflowRun,
	WorkflowRunState,
	WorkflowRunStateAwaitingChildWorkflow,
	WorkflowRunStateAwaitingEvent,
	WorkflowRunStateAwaitingRetry,
	WorkflowRunStateCancelled,
	WorkflowRunStateCompleted,
	WorkflowRunStatePaused,
	WorkflowRunStateScheduled,
	WorkflowRunStateSleeping,
	WorkflowRunStatus,
	WorkflowStartOptions,
} from "./workflow-run";

export interface WorkflowRunApi {
	listV1: (_: WorkflowRunListRequestV1) => Promise<WorkflowRunListResponseV1>;
	getByIdV1: (_: WorkflowRunGetByIdRequestV1) => Promise<WorkflowRunGetByIdResponseV1>;
	getByReferenceIdV1: (_: WorkflowRunGetByReferenceIdRequestV1) => Promise<WorkflowRunGetByReferenceIdResponseV1>;
	getStateV1: (_: WorkflowRunGetStateRequestV1) => Promise<WorkflowRunGetStateResponseV1>;
	createV1: (_: WorkflowRunCreateRequestV1) => Promise<WorkflowRunCreateResponseV1>;
	transitionStateV1: (_: WorkflowRunTransitionStateRequestV1) => Promise<WorkflowRunTransitionStateResponseV1>;
	transitionTaskStateV1: (
		_: WorkflowRunTransitionTaskStateRequestV1
	) => Promise<WorkflowRunTransitionTaskStateResponseV1>;
	setTaskStateV1: (_: WorkflowRunSetTaskStateRequestV1) => Promise<void>;
	listTransitionsV1: (_: WorkflowRunListTransitionsRequestV1) => Promise<WorkflowRunListTransitionsResponseV1>;
	sendEventV1: (_: WorkflowRunSendEventRequestV1) => Promise<void>;
	multicastEventV1: (_: WorkflowRunMulticastEventRequestV1) => Promise<void>;
	multicastEventByReferenceV1: (_: WorkflowRunMulticastEventByReferenceRequestV1) => Promise<void>;
	listChildRunsV1: (_: WorkflowRunListChildRunsRequestV1) => Promise<WorkflowRunListChildRunsResponseV1>;
	cancelByIdsV1: (_: WorkflowRunCancelByIdsRequestV1) => Promise<WorkflowRunCancelByIdsResponseV1>;
	claimReadyV1: (_: WorkflowRunClaimReadyRequestV1) => Promise<WorkflowRunClaimReadyResponseV1>;
	heartbeatV1: (_: WorkflowRunHeartbeatRequestV1) => Promise<void>;
	hasTerminatedV1: (_: WorkflowRunHasTerminatedRequestV1) => Promise<WorkflowRunHasTerminatedResponseV1>;
}

export interface WorkflowRunListRequestV1 {
	limit?: number;
	offset?: number;
	filters?: {
		id?: string;
		scheduleId?: string;
		status?: WorkflowRunStatus[];
		workflow?: WorkflowFilter;
	};
	sort?: {
		order: "asc" | "desc";
	};
}

export type WorkflowFilter =
	| { name: string; source: WorkflowSource }
	| { name: string; source: WorkflowSource; versionId: string }
	| { name: string; source: WorkflowSource; versionId: string; referenceId: string };

export interface WorkflowRunListItem {
	id: string;
	name: string;
	versionId: string;
	createdAt: number;
	status: WorkflowRunStatus;
	referenceId?: string;
	taskCounts?: Record<TaskStatus, number>;
}

export interface WorkflowRunListResponseV1 {
	runs: WorkflowRunListItem[];
	total: number;
}

export interface WorkflowRunGetByIdRequestV1 {
	id: string;
}

export interface WorkflowRunGetByIdResponseV1 {
	run: WorkflowRun;
}

export interface WorkflowRunReference {
	name: string;
	versionId: string;
	referenceId: string;
}

export type WorkflowRunGetByReferenceIdRequestV1 = WorkflowRunReference;

export interface WorkflowRunGetByReferenceIdResponseV1 {
	run: WorkflowRun;
}

export interface WorkflowRunGetStateRequestV1 {
	id: string;
}

export interface WorkflowRunGetStateResponseV1 {
	state: WorkflowRunState;
}

export interface WorkflowRunCreateRequestV1 {
	name: string;
	versionId: string;
	input?: unknown;
	parentWorkflowRunId?: string;
	options?: WorkflowStartOptions;
}

export interface WorkflowRunCreateResponseV1 {
	id: string;
}

export type WorkflowRunStateScheduledRequest = DistributiveOmit<WorkflowRunStateScheduled, "scheduledAt"> & {
	scheduledInMs: number;
};

export type WorkflowRunStateSleepingRequest = DistributiveOmit<WorkflowRunStateSleeping, "awakeAt"> & {
	durationMs: number;
};

export type WorkflowRunStateAwaitingEventRequest = DistributiveOmit<WorkflowRunStateAwaitingEvent, "timeoutAt"> & {
	timeoutInMs?: number;
};

export type WorkflowRunStateAwaitingRetryRequest = DistributiveOmit<WorkflowRunStateAwaitingRetry, "nextAttemptAt"> & {
	nextAttemptInMs: number;
};

export type WorkflowRunStateAwaitingChildWorkflowRequest = DistributiveOmit<
	WorkflowRunStateAwaitingChildWorkflow,
	"timeoutAt"
> & {
	timeoutInMs?: number;
};

export type WorkflowRunStateCompletedRequest = OptionalProp<WorkflowRunStateCompleted<unknown>, "output">;

export type WorkflowRunStateRequest =
	| Exclude<
			WorkflowRunState,
			{
				status:
					| "scheduled"
					| "sleeping"
					| "awaiting_event"
					| "awaiting_retry"
					| "awaiting_child_workflow"
					| "completed";
			}
	  >
	| WorkflowRunStateScheduledRequest
	| WorkflowRunStateSleepingRequest
	| WorkflowRunStateAwaitingEventRequest
	| WorkflowRunStateAwaitingRetryRequest
	| WorkflowRunStateAwaitingChildWorkflowRequest
	| WorkflowRunStateCompletedRequest;

interface WorkflowRunTransitionStateRequestBase {
	type: "optimistic" | "pessimistic";
	id: string;
	state: WorkflowRunStateRequest;
}

export type WorkflowRunStateScheduledRequestOptimistic = Extract<
	WorkflowRunStateScheduledRequest,
	{ reason: "retry" | "task_retry" | "awake" | "event" | "child_workflow" }
>;

export type WorkflowRunStateScheduledRequestPessimistic = Extract<
	WorkflowRunStateScheduledRequest,
	{ reason: "new" | "awake_early" | "resume" }
>;

export interface WorkflowRunTransitionStateRequestOptimistic extends WorkflowRunTransitionStateRequestBase {
	type: "optimistic";
	state:
		| WorkflowRunStateScheduledRequestOptimistic
		| Exclude<WorkflowRunStateRequest, { status: "scheduled" | "paused" | "cancelled" }>;
	expectedRevision: number;
}

export interface WorkflowRunTransitionStateRequestPessimistic extends WorkflowRunTransitionStateRequestBase {
	type: "pessimistic";
	state: WorkflowRunStateScheduledRequestPessimistic | WorkflowRunStatePaused | WorkflowRunStateCancelled;
}

export type WorkflowRunTransitionStateRequestV1 =
	| WorkflowRunTransitionStateRequestOptimistic
	| WorkflowRunTransitionStateRequestPessimistic;

export interface WorkflowRunTransitionStateResponseV1 {
	revision: number;
	state: WorkflowRunState;
	attempts: number;
}

export type TransitionTaskStateToRunning = TransitionTaskStateToRunningCreate | TransitionTaskStateToRunningRetry;

export type WorkflowRunTransitionTaskStateRequestV1 =
	| TransitionTaskStateToRunning
	| TransitionTaskStateToCompleted
	| TransitionTaskStateToFailed
	| TransitionTaskStateToAwaitingRetry;

export interface WorkflowRunTransitionTaskStateResponseV1 {
	taskInfo: TaskInfo;
}

export interface WorkflowRunSetTaskStateRequestNew {
	type: "new";
	id: string;
	taskName: string;
	input?: unknown;
	state: DistributiveOmit<TaskStateCompleted<unknown> | TaskStateFailed, "attempts">;
}

export interface WorkflowRunSetTaskStateRequestExisting {
	type: "existing";
	id: string;
	taskId: string;
	state: DistributiveOmit<TaskStateCompleted<unknown> | TaskStateFailed, "attempts">;
}

export type WorkflowRunSetTaskStateRequestV1 =
	| WorkflowRunSetTaskStateRequestNew
	| WorkflowRunSetTaskStateRequestExisting;

export interface WorkflowRunListTransitionsRequestV1 {
	id: string;
	limit?: number;
	offset?: number;
	sort?: {
		order: "asc" | "desc";
	};
}

export interface WorkflowRunListTransitionsResponseV1 {
	transitions: StateTransition[];
	total: number;
}

export interface WorkflowRunSendEventRequestV1 {
	id: string;
	eventName: string;
	data?: unknown;
	options?: EventSendOptions;
}

export interface WorkflowRunMulticastEventRequestV1 {
	ids: string[];
	eventName: string;
	data?: unknown;
	options?: EventSendOptions;
}

export interface WorkflowRunMulticastEventByReferenceRequestV1 {
	references: WorkflowRunReference[];
	eventName: string;
	data?: unknown;
	options?: EventSendOptions;
}

export interface WorkflowRunListChildRunsRequestV1 {
	parentRunId: string;
	status?: WorkflowRunStatus[];
}

export interface WorkflowRunListChildRunsResponseV1 {
	runs: Array<{ id: string; options?: { shard?: string } }>;
}

export interface WorkflowRunCancelByIdsRequestV1 {
	ids: string[];
}

export interface WorkflowRunCancelByIdsResponseV1 {
	cancelledIds: string[];
}

export interface WorkflowRunClaimReadyRequestV1 {
	workerId: string;
	workflows: Array<{ name: string; versionId: string; shard?: string }>;
	limit: number;
	claimMinIdleTimeMs: number;
}

export interface WorkflowRunClaimReadyResponseV1 {
	runs: Array<{ id: string }>;
}

export interface WorkflowRunHeartbeatRequestV1 {
	id: string;
}

export interface WorkflowRunHasTerminatedRequestV1 {
	id: string;
	afterStateTransitionId: string;
}

export interface WorkflowRunHasTerminatedResponseV1 {
	terminated: boolean;
}
