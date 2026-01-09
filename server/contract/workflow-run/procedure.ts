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
import { type } from "arktype";

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
import {
	taskOptionsSchema,
	taskStateAwaitingRetryRequestSchema,
	taskStateCompletedSchema,
	taskStateFailedSchema,
	taskStateRunningSchema,
} from "../task/schema";

const listV1: ContractProcedure<WorkflowRunListRequestV1, WorkflowRunListResponseV1> = oc
	.input(
		type({
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"filters?": {
				"workflows?": type({
					"id?": "string > 0 | undefined",
					"versionId?": "string > 0 | undefined",
				}).array(),
				"status?": workflowRunStatusSchema.array(),
			},
			"sort?": {
				field: "'createdAt'",
				order: "'asc' | 'desc'",
			},
		})
	)
	.output(
		type({
			runs: type({
				id: "string > 0",
				name: "string > 0",
				versionId: "string > 0",
				createdAt: "number > 0",
				status: workflowRunStatusSchema,
			}).array(),
			total: "number.integer >= 0",
		})
	);

const getByIdV1: ContractProcedure<WorkflowRunGetByIdRequestV1, WorkflowRunGetByIdResponseV1> = oc
	.input(
		type({
			id: "string > 0",
		})
	)
	.output(
		type({
			run: workflowRunSchema,
		})
	);

const getStateV1: ContractProcedure<WorkflowRunGetStateRequestV1, WorkflowRunGetStateResponseV1> = oc
	.input(
		type({
			id: "string > 0",
		})
	)
	.output(
		type({
			state: workflowRunStateSchema,
		})
	);

const createV1: ContractProcedure<WorkflowRunCreateRequestV1, WorkflowRunCreateResponseV1> = oc
	.input(
		type({
			name: "string > 0",
			versionId: "string > 0",
			"input?": "unknown",
			"parentWorkflowRunId?": "string > 0 | undefined",
			"options?": workflowOptionsSchema,
		})
	)
	.output(
		type({
			run: workflowRunSchema,
		})
	);

const transitionStateV1: ContractProcedure<WorkflowRunTransitionStateRequestV1, WorkflowRunTransitionStateResponseV1> =
	oc
		.input(
			type({
				type: "'optimistic'",
				id: "string > 0",
				state: workflowRunStateScheduledRequestOptimisticSchema
					.or(workflowRunStateQueuedSchema)
					.or(workflowRunStateRunningSchema)
					.or(workflowRunStateSleepingSchema)
					.or(workflowRunStateAwaitingEventRequestSchema)
					.or(workflowRunStateAwaitingRetryRequestSchema)
					.or(workflowRunStateAwaitingChildWorkflowRequestSchema)
					.or(workflowRunStateCompletedSchema)
					.or(workflowRunStateFailedSchema),
				expectedRevision: "number.integer >= 0",
			}).or({
				type: "'pessimistic'",
				id: "string > 0",
				state: workflowRunStateScheduledRequestPessimisticSchema
					.or(workflowRunStatePausedSchema)
					.or(workflowRunStateCancelledSchema),
			})
		)
		.output(
			type({
				run: workflowRunSchema,
			})
		);

const transitionTaskStateV1: ContractProcedure<
	WorkflowRunTransitionTaskStateRequestV1,
	WorkflowRunTransitionTaskStateResponseV1
> = oc
	.input(
		type({
			type: "'create'",
			id: "string > 0",
			taskName: "string > 0",
			"options?": taskOptionsSchema,
			taskState: taskStateRunningSchema,
			expectedRevision: "number.integer >= 0",
		})
			.or({
				type: "'retry'",
				id: "string > 0",
				taskId: "string > 0",
				"options?": taskOptionsSchema,
				taskState: taskStateRunningSchema,
				expectedRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				taskId: "string > 0",
				taskState: taskStateCompletedSchema,
				expectedRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				taskId: "string > 0",
				taskState: taskStateFailedSchema,
				expectedRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				taskId: "string > 0",
				taskState: taskStateAwaitingRetryRequestSchema,
				expectedRevision: "number.integer >= 0",
			})
	)
	.output(
		type({
			run: workflowRunSchema,
			taskId: "string > 0",
		})
	);

const setTaskStateV1: ContractProcedure<WorkflowRunSetTaskStateRequestV1, WorkflowRunSetTaskStateResponseV1> = oc
	.input(workflowRunSetTaskStateRequestSchema)
	.output(
		type({
			run: workflowRunSchema,
		})
	);

const listTransitionsV1: ContractProcedure<WorkflowRunListTransitionsRequestV1, WorkflowRunListTransitionsResponseV1> =
	oc
		.input(
			type({
				id: "string > 0",
				"limit?": "number.integer > 0 | undefined",
				"offset?": "number.integer >= 0 | undefined",
				"sort?": {
					field: "'createdAt'",
					order: "'asc' | 'desc'",
				},
			})
		)
		.output(
			type({
				transitions: workflowRunTransitionSchema.array(),
				total: "number.integer >= 0",
			})
		);

const sendEventV1: ContractProcedure<WorkflowRunSendEventRequestV1, WorkflowRunSendEventResponseV1> = oc
	.input(
		type({
			id: "string > 0",
			eventName: "string > 0",
			data: "unknown",
			"options?": {
				"reference?": { id: "string > 0" },
			},
		})
	)
	.output(
		type({
			run: workflowRunSchema,
		})
	);

const multicastEventV1: ContractProcedure<WorkflowRunMulticastEventRequestV1, void> = oc
	.input(
		type({
			ids: type("string > 0").array(),
			eventName: "string > 0",
			data: "unknown",
			"options?": {
				"reference?": { id: "string > 0" },
			},
		})
	)
	.output(type("undefined"));

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
