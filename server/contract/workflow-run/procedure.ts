import { z } from "zod";
import { oc } from "@orpc/contract";
import {
	workflowOptionsSchema,
	workflowRunSchema,
	workflowRunStateSchema,
	workflowRunStatusSchema,
	workflowRunTransitionSchema,
} from "./schema.ts";
import { taskStateSchema } from "../task/schema.ts";
import type { ContractProcedure, ContractProcedureToApi } from "../helpers/procedure.ts";
import type {
	CreateRequestV1,
	CreateResponseV1,
	GetByIdRequestV1,
	GetByIdResponseV1,
	GetStateRequestV1,
	GetStateResponseV1,
	ListRequestV1,
	ListResponseV1,
	ListTransitionsRequestV1,
	ListTransitionsResponseV1,
	TransitionStateRequestV1,
	TransitionStateResponseV1,
	TransitionTaskStateRequestV1,
	TransitionTaskStateResponseV1,
	WorkflowRunApi,
} from "@aikirun/types/workflow-run-api";
import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";

const listV1: ContractProcedure<ListRequestV1, ListResponseV1> = oc
	.input(z.object({
		limit: z.number().optional(),
		offset: z.number().optional(),
		filters: z.object({
			workflows: z.array(z.object({
				name: z.string().optional(),
				versionId: z.string().optional(),
			})).optional(),
			status: z.array(workflowRunStatusSchema).optional(),
		}).optional(),
		sort: z.object({
			field: z.literal("createdAt"),
			order: z.enum(["asc", "desc"]),
		}).optional(),
	}))
	.output(z.object({
		runs: z.array(z.object({
			id: z.string(),
			name: z.string(),
			versionId: z.string(),
			createdAt: z.number(),
			status: workflowRunStatusSchema,
		})),
		total: z.number(),
	}));

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
	.output(z.object({
		newRevision: z.number(),
	}));

const transitionTaskStateV1: ContractProcedure<TransitionTaskStateRequestV1, TransitionTaskStateResponseV1> = oc
	.input(z.object({
		id: z.string(),
		taskPath: z.string(),
		taskState: taskStateSchema,
		expectedRevision: z.number(),
	}))
	.output(z.object({
		newRevision: z.number(),
	}));

const listTransitionsV1: ContractProcedure<ListTransitionsRequestV1, ListTransitionsResponseV1> = oc
	.input(z.object({
		id: z.string().min(1),
		limit: z.number().optional(),
		offset: z.number().optional(),
		sort: z.object({
			field: z.literal("createdAt"),
			order: z.enum(["asc", "desc"]),
		}).optional(),
	}))
	.output(z.object({
		transitions: z.array(workflowRunTransitionSchema),
		total: z.number(),
	}));

export const workflowRunContract = {
	listV1,
	getByIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	transitionTaskStateV1,
	listTransitionsV1,
};

export type WorkflowRunContract = typeof workflowRunContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowRunContract>, WorkflowRunApi>>;
