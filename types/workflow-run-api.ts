import type {
	WorkflowOptions,
	WorkflowRun,
	WorkflowRunState,
	WorkflowRunStatus,
	WorkflowRunTransition,
} from "./workflow-run.ts";
import type { TaskState } from "./task.ts";

export interface WorkflowRunApi {
	listV1: (input: ListRequestV1) => Promise<ListResponseV1>;
	getByIdV1: (input: GetByIdRequestV1) => Promise<GetByIdResponseV1>;
	getStateV1: (input: GetStateRequestV1) => Promise<GetStateResponseV1>;
	createV1: (input: CreateRequestV1) => Promise<CreateResponseV1>;
	transitionStateV1: (input: TransitionStateRequestV1) => Promise<TransitionStateResponseV1>;
	transitionTaskStateV1: (input: TransitionTaskStateRequestV1) => Promise<TransitionTaskStateResponseV1>;
	listTransitionsV1: (input: ListTransitionsRequestV1) => Promise<ListTransitionsResponseV1>;
}

export interface ListRequestV1 {
	limit?: number;
	offset?: number;
	filters?: {
		workflows?: {
			name?: string;
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
	name: string;
	versionId: string;
	createdAt: number;
	status: WorkflowRunStatus;
}

export interface ListResponseV1 {
	runs: WorkflowRunListItem[];
	total: number;
}

export interface GetByIdRequestV1 {
	id: string;
}

export interface GetByIdResponseV1 {
	run: WorkflowRun;
}

export interface GetStateRequestV1 {
	id: string;
}

export interface GetStateResponseV1 {
	state: WorkflowRunState<unknown>;
}

export interface CreateRequestV1 {
	name: string;
	versionId: string;
	input: unknown;
	options?: WorkflowOptions;
}

export interface CreateResponseV1 {
	run: WorkflowRun;
}

export interface TransitionStateRequestV1 {
	id: string;
	state: WorkflowRunState<unknown>;
	expectedRevision: number;
}

export interface TransitionStateResponseV1 {
	newRevision: number;
}

export interface TransitionTaskStateRequestV1 {
	id: string;
	taskPath: string;
	taskState: TaskState<unknown>;
	expectedRevision: number;
}

export interface TransitionTaskStateResponseV1 {
	newRevision: number;
}

export interface ListTransitionsRequestV1 {
	id: string;
	limit?: number;
	offset?: number;
	sort?: {
		field: "createdAt";
		order: "asc" | "desc";
	};
}

export interface ListTransitionsResponseV1 {
	transitions: WorkflowRunTransition[];
	total: number;
}
