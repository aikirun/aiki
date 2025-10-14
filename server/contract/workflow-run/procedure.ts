import { z } from "zod";
import { oc } from "@orpc/contract";
import { workflowOptionsSchema, workflowRunResultSchema, workflowRunSchema, workflowRunStateSchema } from "./schema.ts";
import { taskStateSchema } from "../task/schema.ts";
import type { ContractProcedure, ContractProcedureToApi } from "../helpers/procedure.ts";
import type {
	CreateRequestV1,
	CreateResponseV1,
	GetByIdRequestV1,
	GetByIdResponseV1,
	GetResultRequestV1,
	GetResultResponseV1,
	TransitionTaskStateRequestV1,
	TransitionTaskStateResponseV1,
	UpdateStateRequestV1,
	UpdateStateResponseV2,
	WorkflowRunApi,
} from "@aiki/types/workflow-run-api";
import type { Equal, ExpectTrue } from "@aiki/lib/testing/expect";

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

const transitionTaskStateV1: ContractProcedure<TransitionTaskStateRequestV1, TransitionTaskStateResponseV1> = oc
	.input(z.object({
		id: z.string(),
		taskPath: z.string(),
		taskState: taskStateSchema,
	}))
	.output(z.object({}));

const updateStateV1: ContractProcedure<UpdateStateRequestV1, UpdateStateResponseV2> = oc
	.input(z.object({
		id: z.string().min(1),
		state: workflowRunStateSchema,
	}))
	.output(z.object({}));

export const workflowRunContract = {
	getByIdV1,
	getResultV1,
	createV1,
	transitionTaskStateV1,
	updateStateV1,
};

export type WorkflowRunContract = typeof workflowRunContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowRunContract>, WorkflowRunApi>>;
