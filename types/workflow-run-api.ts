import type { EventSendOptions } from "./event";
import type { TaskState, TaskStateAwaitingRetry, TaskStateCompleted, TaskStateFailed } from "./task";
import type { DistributiveOmit } from "./utils";
import type {
	WorkflowOptions,
	WorkflowRun,
	WorkflowRunState,
	WorkflowRunStateAwaitingChildWorkflow,
	WorkflowRunStateAwaitingEvent,
	WorkflowRunStateAwaitingRetry,
	WorkflowRunStateCancelled,
	WorkflowRunStatePaused,
	WorkflowRunStateScheduled,
	WorkflowRunStatus,
	WorkflowRunTransition,
} from "./workflow-run";

export interface WorkflowRunApi {
	listV1: (_: WorkflowRunListRequestV1) => Promise<WorkflowRunListResponseV1>;
	getByIdV1: (_: WorkflowRunGetByIdRequestV1) => Promise<WorkflowRunGetByIdResponseV1>;
	getStateV1: (_: WorkflowRunGetStateRequestV1) => Promise<WorkflowRunGetStateResponseV1>;
	createV1: (_: WorkflowRunCreateRequestV1) => Promise<WorkflowRunCreateResponseV1>;
	// TODO: instead of throwing conflict error, return good error type
	transitionStateV1: (_: WorkflowRunTransitionStateRequestV1) => Promise<WorkflowRunTransitionStateResponseV1>;
	transitionTaskStateV1: (
		_: WorkflowRunTransitionTaskStateRequestV1
	) => Promise<WorkflowRunTransitionTaskStateResponseV1>;
	setTaskStateV1: (_: WorkflowRunSetTaskStateRequestV1) => Promise<WorkflowRunSetTaskStateResponseV1>;
	listTransitionsV1: (_: WorkflowRunListTransitionsRequestV1) => Promise<WorkflowRunListTransitionsResponseV1>;
	sendEventV1: (_: WorkflowRunSendEventRequestV1) => Promise<WorkflowRunSendEventResponseV1>;
	multicastEventV1: (_: WorkflowRunMulticastEventRequestV1) => Promise<void>;
}

export interface WorkflowRunListRequestV1 {
	limit?: number;
	offset?: number;
	filters?: {
		workflows?: {
			id?: string;
			versionId?: string;
		}[];
		status?: WorkflowRunStatus[];
	};
	sort?: {
		field: "createdAt";
		order: "asc" | "desc";
	};
}

export interface WorkflowRunListItem {
	id: string;
	workflowId: string;
	workflowVersionId: string;
	createdAt: number;
	status: WorkflowRunStatus;
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

export interface WorkflowRunGetStateRequestV1 {
	id: string;
}

export interface WorkflowRunGetStateResponseV1 {
	state: WorkflowRunState;
}

export interface WorkflowRunCreateRequestV1 {
	workflowId: string;
	workflowVersionId: string;
	input: unknown;
	path?: string;
	parentWorkflowRunId?: string;
	options?: WorkflowOptions;
}

export interface WorkflowRunCreateResponseV1 {
	run: WorkflowRun;
}

export type WorkflowRunStateScheduledRequest = DistributiveOmit<WorkflowRunStateScheduled, "scheduledAt"> & {
	scheduledInMs: number;
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

export type WorkflowRunStateRequest =
	| Exclude<WorkflowRunState, { status: "scheduled" | "awaiting_event" | "awaiting_retry" | "awaiting_child_workflow" }>
	| WorkflowRunStateScheduledRequest
	| WorkflowRunStateAwaitingEventRequest
	| WorkflowRunStateAwaitingRetryRequest
	| WorkflowRunStateAwaitingChildWorkflowRequest;

interface WorkflowRunTransitionStateRequestBase {
	type: "optimistic" | "pessimistic";
	id: string;
	state: WorkflowRunStateRequest;
}

export type WorkflowRunStateScheduledRequestOptimistic = Extract<
	WorkflowRunStateScheduledRequest,
	{ reason: "retry" | "task_retry" | "event" | "child_workflow" }
>;

export type WorkflowRunStateScheduledRequestPessimistic = Exclude<
	WorkflowRunStateScheduledRequest,
	WorkflowRunStateScheduledRequestOptimistic
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

export type TaskStateAwaitingRetryRequest = DistributiveOmit<TaskStateAwaitingRetry, "nextAttemptAt"> & {
	nextAttemptInMs: number;
};

export type TaskStateRequest = Exclude<TaskState, { status: "awaiting_retry" }> | TaskStateAwaitingRetryRequest;

export interface WorkflowRunTransitionTaskStateRequestV1 {
	id: string;
	taskPath: string;
	taskState: TaskStateRequest;
	expectedRevision: number;
}

export interface WorkflowRunTransitionTaskStateResponseV1 {
	run: WorkflowRun;
}

export interface WorkflowRunSetTaskStateRequestNew {
	type: "new";
	id: string;
	taskId: string;
	input: unknown;
	reference?: { id: string };
	state: DistributiveOmit<TaskStateCompleted<unknown> | TaskStateFailed, "attempts">;
}

export interface WorkflowRunSetTaskStateRequestExisting {
	type: "existing";
	id: string;
	taskPath: string;
	state: DistributiveOmit<TaskStateCompleted<unknown> | TaskStateFailed, "attempts">;
}

export type WorkflowRunSetTaskStateRequestV1 =
	| WorkflowRunSetTaskStateRequestNew
	| WorkflowRunSetTaskStateRequestExisting;

export interface WorkflowRunSetTaskStateResponseV1 {
	run: WorkflowRun;
}

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
	eventId: string;
	data: unknown;
	options?: EventSendOptions;
}

export interface WorkflowRunSendEventResponseV1 {
	run: WorkflowRun;
}

export interface WorkflowRunMulticastEventRequestV1 {
	ids: string[];
	eventId: string;
	data: unknown;
	options?: EventSendOptions;
}
