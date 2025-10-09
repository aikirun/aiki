import { z } from "zod";
import { os } from "@orpc/server";
import type { WorkflowRunId, WorkflowRunParams, WorkflowRunResult, WorkflowRunRow, WorkflowRunState } from "./types.ts";
import {
	workflowRunParamsSchema,
	workflowRunResultSchema,
	workflowRunRowSchema,
	workflowRunStateSchema,
} from "./schemas.ts";
import type { EmptyObject } from "../../lib/object/types.ts";
import type { TaskRunResult } from "../task/types.ts";
import { taskRunResultSchema } from "../task/schemas.ts";
import type { ProcedureWrapper } from "../procedure-wrapper.ts";

export interface GetReadyIdsRequestV1 {
	size: number;
}

export interface GetReadyIdsResponseV1 {
	ids: WorkflowRunId[];
}

const getReadyIdsV1: ProcedureWrapper<GetReadyIdsRequestV1, GetReadyIdsResponseV1> = os
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

const getByIdV1: ProcedureWrapper<GetByIdRequestV1, GetByIdResponseV1> = os
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

const getResultV1: ProcedureWrapper<GetResultRequestV1, GetResultResponseV1> = os
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		result: workflowRunResultSchema,
	}));

export interface CreateRequestV1 {
	name: string;
	versionId: string;
	params: WorkflowRunParams;
}

export interface CreateResponseV1 {
	run: WorkflowRunRow<unknown, unknown>;
}

const createV1: ProcedureWrapper<CreateRequestV1, CreateResponseV1> = os
	.input(z.object({
		name: z.string().min(1),
		versionId: z.string().min(1),
		params: workflowRunParamsSchema,
	}))
	.output(z.object({
		run: workflowRunRowSchema,
	}));

export interface AddSubTaskRunResultRequestV1 {
	id: string;
	taskPath: string;
	taskResult: TaskRunResult<unknown>;
}

export type AddSubTaskRunResultResponseV1 = EmptyObject;

const addSubTaskRunResultV1: ProcedureWrapper<AddSubTaskRunResultRequestV1, AddSubTaskRunResultResponseV1> = os
	.input(z.object({
		id: z.string(),
		taskPath: z.string(),
		taskResult: taskRunResultSchema,
	}))
	.output(z.object({}));

export interface UpdateStateRequestV1 {
	id: string;
	state: WorkflowRunState;
}

export type UpdateStateResponseV2 = EmptyObject;

const updateStateV1: ProcedureWrapper<UpdateStateRequestV1, UpdateStateResponseV2> = os
	.input(z.object({
		id: z.string().min(1),
		state: workflowRunStateSchema,
	}))
	.output(z.object({}));

export const workflowRunProcedures = {
	getReadyIdsV1,
	getByIdV1,
	getResultV1,
	createV1,
	addSubTaskRunResultV1,
	updateStateV1,
};
