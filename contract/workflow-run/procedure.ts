import { z } from "zod";
import { oc } from "@orpc/contract";
import type { WorkflowOptions, WorkflowRun, WorkflowRunResult, WorkflowRunState } from "@aiki/types/workflow-run";
import { workflowOptionsSchema, workflowRunResultSchema, workflowRunSchema, workflowRunStateSchema } from "./schema.ts";
import type { EmptyRecord } from "@aiki/lib/object";
import type { TaskRunResult } from "@aiki/types/task-run";
import { taskRunResultSchema } from "../task-run/schema.ts";
import type { ContractProcedure } from "../helpers/procedure.ts";

export interface GetReadyIdsRequestV1 {
	size: number;
}

export interface GetReadyIdsResponseV1 {
	ids: string[];
}

const getReadyIdsV1: ContractProcedure<GetReadyIdsRequestV1, GetReadyIdsResponseV1> = oc
	.input(z.object({
		size: z.number().int().positive(),
	}))
	.output(z.object({
		ids: z.array(z.string()),
	}));

export interface GetByIdRequestV1 {
	id: string;
}

export interface GetByIdResponseV1 {
	run: WorkflowRun<unknown, unknown>;
}

const getByIdV1: ContractProcedure<GetByIdRequestV1, GetByIdResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		run: workflowRunSchema,
	}));

export interface GetResultRequestV1 {
	id: string;
}

export interface GetResultResponseV1 {
	result: WorkflowRunResult<unknown>;
}

const getResultV1: ContractProcedure<GetResultRequestV1, GetResultResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		result: workflowRunResultSchema,
	}));

export interface CreateRequestV1 {
	name: string;
	versionId: string;
	input: unknown;
	options?: WorkflowOptions;
}

export interface CreateResponseV1 {
	run: WorkflowRun<unknown, unknown>;
}

const createV1: ContractProcedure<CreateRequestV1, CreateResponseV1> = oc
	.input(z.object({
		name: z.string().min(1),
		versionId: z.string().min(1),
		input: z.unknown(),
		options: workflowOptionsSchema.optional(),
	}))
	.output(z.object({
		run: workflowRunSchema,
	}));

export interface AddSubTaskRunResultRequestV1 {
	id: string;
	taskPath: string;
	taskRunResult: TaskRunResult<unknown>;
}

export type AddSubTaskRunResultResponseV1 = EmptyRecord;

const addSubTaskRunResultV1: ContractProcedure<AddSubTaskRunResultRequestV1, AddSubTaskRunResultResponseV1> = oc
	.input(z.object({
		id: z.string(),
		taskPath: z.string(),
		taskRunResult: taskRunResultSchema,
	}))
	.output(z.object({}));

export interface UpdateStateRequestV1 {
	id: string;
	state: WorkflowRunState;
}

export type UpdateStateResponseV2 = EmptyRecord;

const updateStateV1: ContractProcedure<UpdateStateRequestV1, UpdateStateResponseV2> = oc
	.input(z.object({
		id: z.string().min(1),
		state: workflowRunStateSchema,
	}))
	.output(z.object({}));

export const workflowRunContract = {
	getReadyIdsV1,
	getByIdV1,
	getResultV1,
	createV1,
	addSubTaskRunResultV1,
	updateStateV1,
};

export type WorkflowRunContract = typeof workflowRunContract;
