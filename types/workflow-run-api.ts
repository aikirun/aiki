import type { EventSendOptions } from "./event";
import type {
	TaskInfo,
	TaskStateCompleted,
	TaskStateFailed,
	TransitionTaskStateToAwaitingRetry,
	TransitionTaskStateToCompleted,
	TransitionTaskStateToFailed,
	TransitionTaskStateToRunningCreate,
	TransitionTaskStateToRunningRetry,
} from "./task";
import type { DistributiveOmit, OptionalProp } from "./utils";
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
	WorkflowRunTransition,
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
	sendEventV1: (_: WorkflowRunSendEventRequestV1) => Promise<WorkflowRunSendEventResponseV1>;
	multicastEventV1: (_: WorkflowRunMulticastEventRequestV1) => Promise<void>;
	multicastEventByReferenceV1: (_: WorkflowRunMulticastEventByReferenceRequestV1) => Promise<void>;
}

export interface WorkflowRunListRequestV1 {
	limit?: number;
	offset?: number;
	filters?: {
		id?: string;
		status?: WorkflowRunStatus[];
		workflows?: WorkflowFilter[];
	};
	sort?: {
		field: "createdAt";
		order: "asc" | "desc";
	};
}

export interface WorkflowFilter {
	name: string;
	versionId?: string;
	// TODO: move ref to top level? also consider that ref is scoped to workflow version
	referenceId?: string;
}

export interface WorkflowRunListItem {
	id: string;
	name: string;
	versionId: string;
	createdAt: number;
	status: WorkflowRunStatus;
	referenceId?: string;
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
	run: WorkflowRun;
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
	run: WorkflowRun;
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
	reference?: { id: string }; // TODO: should conflict policy be added?
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
		field: "createdAt";
		order: "asc" | "desc";
	};
}

export interface WorkflowRunListTransitionsResponseV1 {
	transitions: WorkflowRunTransition[];
	total: number;
}

export interface WorkflowRunSendEventRequestV1 {
	id: string;
	eventName: string;
	data?: unknown;
	options?: EventSendOptions;
}

export interface WorkflowRunSendEventResponseV1 {
	run: WorkflowRun;
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
