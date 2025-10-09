import { z } from "zod";
import { oc } from "@orpc/contract";
import type {
	WorkflowRunId,
	WorkflowOptions,
	WorkflowRunResult,
	WorkflowRunRow,
	WorkflowRunState,
} from "./types.ts";
import {
	workflowOptionsSchema,
	workflowRunResultSchema,
	workflowRunRowSchema,
	workflowRunStateSchema,
} from "./schemas.ts";
import type { EmptyRecord } from "../../lib/object/types.ts";
import type { TaskRunResult } from "../task-run/types.ts";
import { taskRunResultSchema } from "../task-run/schemas.ts";
import type { Contract } from "../common/contract.ts";

export interface GetReadyIdsRequestV1 {
	size: number;
}

export interface GetReadyIdsResponseV1 {
	ids: WorkflowRunId[];
}

const getReadyIdsV1: Contract<GetReadyIdsRequestV1, GetReadyIdsResponseV1> = oc
	.input(z.object({
		size: z.number().int().positive(),
	}))
	.output(z.object({
		ids: z.array(z.string().transform((val) => val as WorkflowRunId)),
	}));

export interface GetByIdRequestV1 {
	id: string;
}

export interface GetByIdResponseV1 {
	run?: WorkflowRunRow<unknown, unknown>;
}

const getByIdV1: Contract<GetByIdRequestV1, GetByIdResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		run: workflowRunRowSchema.optional(),
	}));

export interface GetResultRequestV1 {
	id: string;
}

export interface GetResultResponseV1 {
	result: WorkflowRunResult<unknown>;
}

const getResultV1: Contract<GetResultRequestV1, GetResultResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		result: workflowRunResultSchema,
	}));

export interface CreateRequestV1 {
	name: string;
	versionId: string;
	payload: unknown;
	options?: WorkflowOptions;
}

export interface CreateResponseV1 {
	run: WorkflowRunRow<unknown, unknown>;
}

const createV1: Contract<CreateRequestV1, CreateResponseV1> = oc
	.input(z.object({
		name: z.string().min(1),
		versionId: z.string().min(1),
		payload: z.unknown(),
		options: workflowOptionsSchema.optional(),
	}))
	.output(z.object({
		run: workflowRunRowSchema,
	}));

export interface AddSubTaskRunResultRequestV1 {
	id: string;
	taskPath: string;
	taskRunResult: TaskRunResult<unknown>;
}

export type AddSubTaskRunResultResponseV1 = EmptyRecord;

const addSubTaskRunResultV1: Contract<AddSubTaskRunResultRequestV1, AddSubTaskRunResultResponseV1> = oc
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

const updateStateV1: Contract<UpdateStateRequestV1, UpdateStateResponseV2> = oc
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
