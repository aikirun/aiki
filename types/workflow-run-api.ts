import type { WorkflowOptions, WorkflowRun, WorkflowRunState, WorkflowRunStatus } from "./workflow-run.ts";
import type { TaskState } from "./task.ts";

export type EmptyRecord = Record<string, never>;

export interface GetByIdRequestV1 {
	id: string;
}

export interface GetByIdResponseV1 {
	run: WorkflowRun<unknown, unknown>;
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
	run: WorkflowRun<unknown, unknown>;
}

export interface TransitionTaskStateRequestV1 {
	id: string;
	taskPath: string;
	taskState: TaskState<unknown>;
}

export type TransitionTaskStateResponseV1 = EmptyRecord;

export interface TransitionStateRequestV1 {
	id: string;
	status: WorkflowRunStatus;
}

export type TransitionStateResponseV1 = EmptyRecord;

export interface WorkflowRunApi {
	getByIdV1: (input: GetByIdRequestV1) => Promise<GetByIdResponseV1>;
	getStateV1: (input: GetStateRequestV1) => Promise<GetStateResponseV1>;
	createV1: (input: CreateRequestV1) => Promise<CreateResponseV1>;
	transitionTaskStateV1: (input: TransitionTaskStateRequestV1) => Promise<TransitionTaskStateResponseV1>;
	transitionStateV1: (input: TransitionStateRequestV1) => Promise<TransitionStateResponseV1>;
}
