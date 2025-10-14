import { z } from "zod";
import { oc } from "@orpc/contract";
import { workflowOptionsSchema, workflowRunSchema, workflowRunStateSchema } from "./schema.ts";
import { taskStateSchema } from "../task/schema.ts";
import type { ContractProcedure, ContractProcedureToApi } from "../helpers/procedure.ts";
import type {
	CreateRequestV1,
	CreateResponseV1,
	GetByIdRequestV1,
	GetByIdResponseV1,
	GetStateRequestV1,
	GetStateResponseV1,
	TransitionStateRequestV1,
	TransitionStateResponseV1,
	TransitionTaskStateRequestV1,
	TransitionTaskStateResponseV1,
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

const getStateV1: ContractProcedure<GetStateRequestV1, GetStateResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
	}))
	.output(z.object({
		state: workflowRunStateSchema,
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

const transitionStateV1: ContractProcedure<TransitionStateRequestV1, TransitionStateResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
		state: workflowRunStateSchema,
		expectedRevision: z.number(),
	}))
	.output(z.object({}));

const transitionTaskStateV1: ContractProcedure<TransitionTaskStateRequestV1, TransitionTaskStateResponseV1> = oc
	.input(z.object({
		id: z.string(),
		taskPath: z.string(),
		taskState: taskStateSchema,
		expectedRevision: z.number(),
	}))
	.output(z.object({}));

export const workflowRunContract = {
	getByIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	transitionTaskStateV1,
};

export type WorkflowRunContract = typeof workflowRunContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowRunContract>, WorkflowRunApi>>;
