import type { WorkflowOptions, WorkflowRun, WorkflowRunResult, WorkflowRunStatus } from "./workflow-run.ts";
import type { TaskState } from "./task.ts";

export type EmptyRecord = Record<string, never>;

export interface GetByIdRequestV1 {
	id: string;
}

export interface GetByIdResponseV1 {
	run: WorkflowRun<unknown, unknown>;
}

export interface GetResultRequestV1 {
	id: string;
}

export interface GetResultResponseV1 {
	result: WorkflowRunResult<unknown>;
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

export interface UpdateStateRequestV1 {
	id: string;
	state: WorkflowRunStatus;
}

export type UpdateStateResponseV2 = EmptyRecord;

export interface WorkflowRunApi {
	getByIdV1: (input: GetByIdRequestV1) => Promise<GetByIdResponseV1>;
	getResultV1: (input: GetResultRequestV1) => Promise<GetResultResponseV1>;
	createV1: (input: CreateRequestV1) => Promise<CreateResponseV1>;
	transitionTaskStateV1: (input: TransitionTaskStateRequestV1) => Promise<TransitionTaskStateResponseV1>;
	updateStateV1: (input: UpdateStateRequestV1) => Promise<UpdateStateResponseV2>;
}
