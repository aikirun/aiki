import { z } from "zod";
import { oc } from "@orpc/contract";
import { workflowOptionsSchema, workflowRunResultSchema, workflowRunSchema, workflowRunStateSchema } from "./schema.ts";
import { taskRunResultSchema } from "../task-run/schema.ts";
import type { ContractProcedure } from "../helpers/procedure.ts";
import type {
	AddSubTaskRunResultRequestV1,
	AddSubTaskRunResultResponseV1,
	CreateRequestV1,
	CreateResponseV1,
	GetByIdRequestV1,
	GetByIdResponseV1,
	GetReadyIdsRequestV1,
	GetReadyIdsResponseV1,
	GetResultRequestV1,
	GetResultResponseV1,
	UpdateStateRequestV1,
	UpdateStateResponseV2,
} from "@aiki/types/workflow-run-api";

const getReadyIdsV1: ContractProcedure<GetReadyIdsRequestV1, GetReadyIdsResponseV1> = oc
	.input(z.object({
		size: z.number().int().positive(),
	}))
	.output(z.object({
		ids: z.array(z.string()),
	}));

const getByIdV1: ContractProcedure<GetByIdRequestV1, GetByIdResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		run: workflowRunSchema,
	}));

const getResultV1: ContractProcedure<GetResultRequestV1, GetResultResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		result: workflowRunResultSchema,
	}));

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

const addSubTaskRunResultV1: ContractProcedure<AddSubTaskRunResultRequestV1, AddSubTaskRunResultResponseV1> = oc
	.input(z.object({
		id: z.string(),
		taskPath: z.string(),
		taskRunResult: taskRunResultSchema,
	}))
	.output(z.object({}));

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
