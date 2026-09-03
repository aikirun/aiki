import type { DistributiveOmit, OptionalProp } from "@aikirun/lib/object";

import type { Hash } from "../infra/hasher";
import type { WorkflowSource } from "../workflow";
import type {
	WaitingForSignalWorkflowRunStatus,
	WorkflowRunRecord,
	WorkflowRunState,
	WorkflowRunStateAwaitingChildWorkflow,
	WorkflowRunStateAwaitingEvent,
	WorkflowRunStateAwaitingRetry,
	WorkflowRunStateCancelled,
	WorkflowRunStateCompleted,
	WorkflowRunStatePaused,
	WorkflowRunStateScheduled,
	WorkflowRunStateSleeping,
	WorkflowRunStateStalled,
	WorkflowRunStatus,
	WorkflowStartOptions,
} from "../workflow/run";
import type { EventMulticastResult, EventSendOptions } from "../workflow/run/event";
import type { StateTransition } from "../workflow/state-transition";
import type { TaskStatus } from "../workflow/task";

export interface WorkflowRunApi {
	listV1: (_: WorkflowRunListRequestV1) => Promise<WorkflowRunListResponseV1>;
	getByIdV1: (_: WorkflowRunGetByIdRequestV1) => Promise<WorkflowRunGetByIdResponseV1>;
	getByReferenceIdV1: (_: WorkflowRunGetByReferenceIdRequestV1) => Promise<WorkflowRunGetByReferenceIdResponseV1>;
	getStateV1: (_: WorkflowRunGetStateRequestV1) => Promise<WorkflowRunGetStateResponseV1>;
	createV1: (_: WorkflowRunCreateRequestV1) => Promise<WorkflowRunCreateResponseV1>;
	transitionStateV1: (_: WorkflowRunTransitionStateRequestV1) => Promise<WorkflowRunTransitionStateResponseV1>;
	listTransitionsV1: (_: WorkflowRunListTransitionsRequestV1) => Promise<WorkflowRunListTransitionsResponseV1>;
	sendEventV1: (_: WorkflowRunSendEventRequestV1) => Promise<void>;
	multicastEventV1: (_: WorkflowRunMulticastEventRequestV1) => Promise<WorkflowRunMulticastEventResponseV1>;
	multicastEventByReferenceV1: (
		_: WorkflowRunMulticastEventByReferenceRequestV1
	) => Promise<WorkflowRunMulticastEventResponseV1>;
	listChildRunsV1: (_: WorkflowRunListChildRunsRequestV1) => Promise<WorkflowRunListChildRunsResponseV1>;
	cancelByIdsV1: (_: WorkflowRunCancelByIdsRequestV1) => Promise<WorkflowRunCancelByIdsResponseV1>;
	claimReadyV1: (_: WorkflowRunClaimReadyRequestV1) => Promise<WorkflowRunClaimReadyResponseV1>;
	claimRefreshV1: (_: WorkflowRunClaimRefreshRequestV1) => Promise<void>;
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
	run: WorkflowRunRecord;
}

export interface WorkflowRunReference {
	name: string;
	versionId: string;
	referenceId: string;
}

export type WorkflowRunGetByReferenceIdRequestV1 = WorkflowRunReference;

export interface WorkflowRunGetByReferenceIdResponseV1 {
	run: WorkflowRunRecord;
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
	inputHash: Hash;
	parent?: {
		workflowRunId: string;
		expectedRevision: number;
	};
	options?: WorkflowStartOptions;
}

export interface WorkflowRunCreateResponseV1 {
	id: string;
}

export type WorkflowRunStateScheduledRequest = DistributiveOmit<WorkflowRunStateScheduled, "scheduledAt"> & {
	scheduledInMs: number;
};

export type WorkflowRunStateSleepingRequest = DistributiveOmit<WorkflowRunStateSleeping, "wakeupAt"> & {
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
					| "awaiting_task_retry"
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

type WorkflowRunStateRequestOptimistic = Exclude<WorkflowRunStateRequest, WorkflowRunStateRequestPessimistic>;

type WorkflowRunStateRequestPessimistic =
	| Extract<WorkflowRunStateScheduledRequest, { reason: "new" | "wakeup_early" | "resumption" | "redelivery" }>
	| WorkflowRunStatePaused
	| WorkflowRunStateStalled
	| WorkflowRunStateCancelled;

export type WorkflowRunTransitionStateRequestOptimistic = {
	type: "optimistic";
	id: string;
	expectedRevision: number;
} & (
	| {
			state: Extract<WorkflowRunStateRequestOptimistic, { status: WaitingForSignalWorkflowRunStatus }>;
			expectedSignalSequence: number;
	  }
	| {
			state: Exclude<WorkflowRunStateRequestOptimistic, { status: WaitingForSignalWorkflowRunStatus }>;
	  }
);

export interface WorkflowRunTransitionStateRequestPessimistic {
	type: "pessimistic";
	id: string;
	state: WorkflowRunStateRequestPessimistic;
}

export type WorkflowRunTransitionStateRequestV1 =
	| WorkflowRunTransitionStateRequestOptimistic
	| WorkflowRunTransitionStateRequestPessimistic;

export interface WorkflowRunTransitionStateResponseV1 {
	revision: number;
	state: WorkflowRunState;
	attempts: number;
}

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

export type WorkflowRunMulticastEventResponseV1 = EventMulticastResult;

export interface WorkflowRunListChildRunsRequestV1 {
	id: string;
	childRunStatus?: WorkflowRunStatus[];
}

export interface WorkflowRunListChildRunsResponseV1 {
	runs: Array<{ id: string; options?: { pool?: string } }>;
}

export interface WorkflowRunCancelByIdsRequestV1 {
	ids: string[];
}

export interface WorkflowRunCancelByIdsResponseV1 {
	cancelledIds: string[];
}

export interface WorkflowRunClaimReadyRequestV1 {
	workflows: Array<{ source: WorkflowSource; name: string; versionId: string }>;
	pools?: string[];
	limit: number;
}

export interface WorkflowRunClaimReadyResponseV1 {
	runs: Array<{ id: string }>;
}

export interface WorkflowRunClaimRefreshRequestV1 {
	id: string;
}

export interface WorkflowRunHasTerminatedRequestV1 {
	id: string;
	afterStateTransitionId: string;
}

export interface WorkflowRunHasTerminatedResponseV1 {
	terminated: boolean;
	latestStateTransitionId: string;
}
