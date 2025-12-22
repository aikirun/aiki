import type {
	TaskStateAwaitingRetry,
	TaskStateCompleted,
	TaskStateFailed,
	TaskStateNone,
	TaskStateRunning,
} from "./task";
import type {
	WorkflowOptions,
	WorkflowRun,
	WorkflowRunState,
	WorkflowRunStateCancelled,
	WorkflowRunStatePaused,
	WorkflowRunStateScheduled,
	WorkflowRunStateScheduledByNew,
	WorkflowRunStateScheduledByResume,
	WorkflowRunStatus,
	WorkflowRunTransition,
} from "./workflow-run";

export interface WorkflowRunApi {
	listV1: (input: WorkflowRunListRequestV1) => Promise<WorkflowRunListResponseV1>;
	getByIdV1: (input: WorkflowRunGetByIdRequestV1) => Promise<WorkflowRunGetByIdResponseV1>;
	getStateV1: (input: WorkflowRunGetStateRequestV1) => Promise<WorkflowRunGetStateResponseV1>;
	createV1: (input: WorkflowRunCreateRequestV1) => Promise<WorkflowRunCreateResponseV1>;
	// TODO: instead of throwing conflict error, return good error type
	transitionStateV1: (input: WorkflowRunTransitionStateRequestV1) => Promise<WorkflowRunTransitionStateResponseV1>;
	transitionTaskStateV1: (
		input: WorkflowRunTransitionTaskStateRequestV1
	) => Promise<WorkflowRunTransitionTaskStateResponseV1>;
	listTransitionsV1: (input: WorkflowRunListTransitionsRequestV1) => Promise<WorkflowRunListTransitionsResponseV1>;
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
	state: WorkflowRunState<unknown>;
}

export interface WorkflowRunCreateRequestV1 {
	workflowId: string;
	workflowVersionId: string;
	input: unknown;
	options?: WorkflowOptions;
}

export interface WorkflowRunCreateResponseV1 {
	run: WorkflowRun;
}

interface WorkflowRunTransitionStateRequestBase {
	type: "optimistic" | "pessimistic";
	id: string;
	state: WorkflowRunState<unknown>;
}

interface WorkflowRunTransitionStateRequestOptimistic extends WorkflowRunTransitionStateRequestBase {
	type: "optimistic";
	state:
		| Exclude<WorkflowRunState<unknown>, { status: "scheduled" | "paused" | "cancelled" }>
		| Exclude<WorkflowRunStateScheduled, { reason: "new" | "resume" }>;
	expectedRevision: number;
}

interface WorkflowRunTransitionStateRequestPessimistic extends WorkflowRunTransitionStateRequestBase {
	type: "pessimistic";
	state:
		| WorkflowRunStateScheduledByNew
		| WorkflowRunStateScheduledByResume
		| WorkflowRunStatePaused
		| WorkflowRunStateCancelled;
}

export type WorkflowRunTransitionStateRequestV1 =
	| WorkflowRunTransitionStateRequestOptimistic
	| WorkflowRunTransitionStateRequestPessimistic;

export interface WorkflowRunTransitionStateResponseV1 {
	run: WorkflowRun;
}

export type TaskStateRequest =
	| TaskStateNone
	| TaskStateRunning
	| (Omit<TaskStateAwaitingRetry, "nextAttemptAt"> & { nextAttemptInMs: number })
	| TaskStateCompleted<unknown>
	| TaskStateFailed;

export interface WorkflowRunTransitionTaskStateRequestV1 {
	id: string;
	taskPath: string;
	taskState: TaskStateRequest;
	expectedRevision: number;
}

export interface WorkflowRunTransitionTaskStateResponseV1 {
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
