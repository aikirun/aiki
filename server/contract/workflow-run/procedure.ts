import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	WorkflowRunApi,
	WorkflowRunCreateRequestV1,
	WorkflowRunCreateResponseV1,
	WorkflowRunGetByIdRequestV1,
	WorkflowRunGetByIdResponseV1,
	WorkflowRunGetStateRequestV1,
	WorkflowRunGetStateResponseV1,
	WorkflowRunListRequestV1,
	WorkflowRunListResponseV1,
	WorkflowRunListTransitionsRequestV1,
	WorkflowRunListTransitionsResponseV1,
	WorkflowRunMulticastEventRequestV1,
	WorkflowRunSendEventRequestV1,
	WorkflowRunSendEventResponseV1,
	WorkflowRunSetTaskStateRequestV1,
	WorkflowRunSetTaskStateResponseV1,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
	WorkflowRunTransitionTaskStateRequestV1,
	WorkflowRunTransitionTaskStateResponseV1,
} from "@aikirun/types/workflow-run-api";
import { oc } from "@orpc/contract";
import { z } from "zod";

import {
	workflowOptionsSchema,
	workflowRunSchema,
	workflowRunSetTaskStateRequestSchema,
	workflowRunStateAwaitingChildWorkflowRequestSchema,
	workflowRunStateAwaitingEventRequestSchema,
	workflowRunStateAwaitingRetryRequestSchema,
	workflowRunStateCancelledSchema,
	workflowRunStateCompletedSchema,
	workflowRunStateFailedSchema,
	workflowRunStatePausedSchema,
	workflowRunStateQueuedSchema,
	workflowRunStateRunningSchema,
	workflowRunStateScheduledRequestOptimisticSchema,
	workflowRunStateScheduledRequestPessimisticSchema,
	workflowRunStateSchema,
	workflowRunStateSleepingSchema,
	workflowRunStatusSchema,
	workflowRunTransitionSchema,
} from "./schema";
import type { ContractProcedure, ContractProcedureToApi } from "../helpers/procedure";
import { taskStateRequestSchema } from "../task/schema";

const listV1: ContractProcedure<WorkflowRunListRequestV1, WorkflowRunListResponseV1> = oc
	.input(
		z.object({
			limit: z.number().optional(),
			offset: z.number().optional(),
			filters: z
				.object({
					workflows: z
						.array(
							z.object({
								id: z.string().optional(),
								versionId: z.string().optional(),
							})
						)
						.optional(),
					status: z.array(workflowRunStatusSchema).optional(),
				})
				.optional(),
			sort: z
				.object({
					field: z.literal("createdAt"),
					order: z.enum(["asc", "desc"]),
				})
				.optional(),
		})
	)
	.output(
		z.object({
			runs: z.array(
				z.object({
					id: z.string(),
					workflowId: z.string(),
					workflowVersionId: z.string(),
					createdAt: z.number(),
					status: workflowRunStatusSchema,
				})
			),
			total: z.number(),
		})
	);

const getByIdV1: ContractProcedure<WorkflowRunGetByIdRequestV1, WorkflowRunGetByIdResponseV1> = oc
	.input(
		z.object({
			id: z.string().min(1),
		})
	)
	.output(
		z.object({
			run: workflowRunSchema,
		})
	);

const getStateV1: ContractProcedure<WorkflowRunGetStateRequestV1, WorkflowRunGetStateResponseV1> = oc
	.input(
		z.object({
			id: z.string().min(1),
		})
	)
	.output(
		z.object({
			state: workflowRunStateSchema,
		})
	);

const createV1: ContractProcedure<WorkflowRunCreateRequestV1, WorkflowRunCreateResponseV1> = oc
	.input(
		z.object({
			workflowId: z.string().min(1),
			workflowVersionId: z.string().min(1),
			input: z.unknown(),
			path: z.string().optional(),
			parentWorkflowRunId: z.string().min(1).optional(),
			options: workflowOptionsSchema.optional(),
		})
	)
	.output(
		z.object({
			run: workflowRunSchema,
		})
	);

const transitionStateV1: ContractProcedure<WorkflowRunTransitionStateRequestV1, WorkflowRunTransitionStateResponseV1> =
	oc
		.input(
			z.union([
				z.object({
					type: z.literal("optimistic"),
					id: z.string().min(1),
					state: z.union([
						workflowRunStateScheduledRequestOptimisticSchema,
						workflowRunStateQueuedSchema,
						workflowRunStateRunningSchema,
						workflowRunStateSleepingSchema,
						workflowRunStateAwaitingEventRequestSchema,
						workflowRunStateAwaitingRetryRequestSchema,
						workflowRunStateAwaitingChildWorkflowRequestSchema,
						workflowRunStateCompletedSchema,
						workflowRunStateFailedSchema,
					]),
					expectedRevision: z.number(),
				}),
				z.object({
					type: z.literal("pessimistic"),
					id: z.string().min(1),
					state: z.union([
						workflowRunStateScheduledRequestPessimisticSchema,
						workflowRunStatePausedSchema,
						workflowRunStateCancelledSchema,
					]),
				}),
			])
		)
		.output(
			z.object({
				run: workflowRunSchema,
			})
		);

const transitionTaskStateV1: ContractProcedure<
	WorkflowRunTransitionTaskStateRequestV1,
	WorkflowRunTransitionTaskStateResponseV1
> = oc
	.input(
		z.object({
			id: z.string(),
			taskPath: z.string(),
			taskState: taskStateRequestSchema,
			expectedRevision: z.number(),
		})
	)
	.output(
		z.object({
			run: workflowRunSchema,
		})
	);

const setTaskStateV1: ContractProcedure<WorkflowRunSetTaskStateRequestV1, WorkflowRunSetTaskStateResponseV1> = oc
	.input(workflowRunSetTaskStateRequestSchema)
	.output(
		z.object({
			run: workflowRunSchema,
		})
	);

const listTransitionsV1: ContractProcedure<WorkflowRunListTransitionsRequestV1, WorkflowRunListTransitionsResponseV1> =
	oc
		.input(
			z.object({
				id: z.string().min(1),
				limit: z.number().optional(),
				offset: z.number().optional(),
				sort: z
					.object({
						field: z.literal("createdAt"),
						order: z.enum(["asc", "desc"]),
					})
					.optional(),
			})
		)
		.output(
			z.object({
				transitions: z.array(workflowRunTransitionSchema),
				total: z.number(),
			})
		);

const sendEventV1: ContractProcedure<WorkflowRunSendEventRequestV1, WorkflowRunSendEventResponseV1> = oc
	.input(
		z.object({
			id: z.string().min(1),
			eventId: z.string().min(1),
			data: z.unknown(),
			options: z
				.object({
					idempotencyKey: z.string().optional(),
				})
				.optional(),
		})
	)
	.output(
		z.object({
			run: workflowRunSchema,
		})
	);

const multicastEventV1: ContractProcedure<WorkflowRunMulticastEventRequestV1, void> = oc
	.input(
		z.object({
			ids: z.array(z.string().min(1)),
			eventId: z.string().min(1),
			data: z.unknown(),
			options: z
				.object({
					idempotencyKey: z.string().optional(),
				})
				.optional(),
		})
	)
	.output(z.void());

export const workflowRunContract = {
	listV1,
	getByIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	transitionTaskStateV1,
	setTaskStateV1,
	listTransitionsV1,
	sendEventV1,
	multicastEventV1,
};

export type WorkflowRunContract = typeof workflowRunContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowRunContract>, WorkflowRunApi>>;
