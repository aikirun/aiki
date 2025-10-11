import type { WorkflowOptions, WorkflowRun, WorkflowRunResult, WorkflowRunState } from "./workflow-run.ts";
import type { TaskRunResult } from "./task-run.ts";

export type EmptyRecord = Record<string, never>;

export interface GetReadyIdsRequestV1 {
	size: number;
}

export interface GetReadyIdsResponseV1 {
	ids: string[];
}

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

export interface AddSubTaskRunResultRequestV1 {
	id: string;
	taskPath: string;
	taskRunResult: TaskRunResult<unknown>;
}

export type AddSubTaskRunResultResponseV1 = EmptyRecord;

export interface UpdateStateRequestV1 {
	id: string;
	state: WorkflowRunState;
}

export type UpdateStateResponseV2 = EmptyRecord;

export interface WorkflowRunApi {
	getReadyIdsV1: (input: GetReadyIdsRequestV1) => Promise<GetReadyIdsResponseV1>;
	getByIdV1: (input: GetByIdRequestV1) => Promise<GetByIdResponseV1>;
	getResultV1: (input: GetResultRequestV1) => Promise<GetResultResponseV1>;
	createV1: (input: CreateRequestV1) => Promise<CreateResponseV1>;
	addSubTaskRunResultV1: (input: AddSubTaskRunResultRequestV1) => Promise<AddSubTaskRunResultResponseV1>;
	updateStateV1: (input: UpdateStateRequestV1) => Promise<UpdateStateResponseV2>;
}
