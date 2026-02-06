import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	WorkflowRunApi,
	WorkflowRunCreateRequestV1,
	WorkflowRunCreateResponseV1,
	WorkflowRunGetByIdRequestV1,
	WorkflowRunGetByIdResponseV1,
	WorkflowRunGetByReferenceIdRequestV1,
	WorkflowRunGetByReferenceIdResponseV1,
	WorkflowRunGetStateRequestV1,
	WorkflowRunGetStateResponseV1,
	WorkflowRunListRequestV1,
	WorkflowRunListResponseV1,
	WorkflowRunListTransitionsRequestV1,
	WorkflowRunListTransitionsResponseV1,
	WorkflowRunMulticastEventByReferenceRequestV1,
	WorkflowRunMulticastEventRequestV1,
	WorkflowRunSendEventRequestV1,
	WorkflowRunSendEventResponseV1,
	WorkflowRunSetTaskStateRequestV1,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
	WorkflowRunTransitionTaskStateRequestV1,
	WorkflowRunTransitionTaskStateResponseV1,
} from "@aikirun/types/workflow-run-api";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";
import {
	taskInfoSchema,
	taskOptionsSchema,
	taskStateAwaitingRetryRequestSchema,
	taskStateCompletedRequestSchema,
	taskStateFailedSchema,
	taskStateRunningRequestSchema,
} from "../schema/task";
import {
	workflowOptionsSchema,
	workflowRunSchema,
	workflowRunSetTaskStateRequestSchema,
	workflowRunStateAwaitingChildWorkflowRequestSchema,
	workflowRunStateAwaitingEventRequestSchema,
	workflowRunStateAwaitingRetryRequestSchema,
	workflowRunStateCancelledSchema,
	workflowRunStateCompletedRequestSchema,
	workflowRunStateFailedSchema,
	workflowRunStatePausedSchema,
	workflowRunStateQueuedSchema,
	workflowRunStateRunningSchema,
	workflowRunStateScheduledRequestOptimisticSchema,
	workflowRunStateScheduledRequestPessimisticSchema,
	workflowRunStateSchema,
	workflowRunStateSleepingRequestSchema,
	workflowRunStatusSchema,
	workflowRunTransitionSchema,
} from "../schema/workflow-run";

const listV1: ContractProcedure<WorkflowRunListRequestV1, WorkflowRunListResponseV1> = oc
	.input(
		type({
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"filters?": {
				"id?": "string > 0 | undefined",
				"status?": workflowRunStatusSchema.array(),
				"workflows?": type({
					name: "string > 0",
					"versionId?": "string > 0 | undefined",
					"referenceId?": "string > 0 | undefined",
				}).array(),
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
				"referenceId?": "string > 0 | undefined",
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

const getByReferenceIdV1: ContractProcedure<
	WorkflowRunGetByReferenceIdRequestV1,
	WorkflowRunGetByReferenceIdResponseV1
> = oc
	.input(
		type({
			name: "string > 0",
			versionId: "string > 0",
			referenceId: "string > 0",
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
					.or(workflowRunStateSleepingRequestSchema)
					.or(workflowRunStateAwaitingEventRequestSchema)
					.or(workflowRunStateAwaitingRetryRequestSchema)
					.or(workflowRunStateAwaitingChildWorkflowRequestSchema)
					.or(workflowRunStateCompletedRequestSchema)
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
			taskState: taskStateRunningRequestSchema,
			expectedWorkflowRunRevision: "number.integer >= 0",
		})
			.or({
				type: "'retry'",
				id: "string > 0",
				taskId: "string > 0",
				"options?": taskOptionsSchema,
				taskState: taskStateRunningRequestSchema,
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				taskId: "string > 0",
				taskState: taskStateCompletedRequestSchema,
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				taskId: "string > 0",
				taskState: taskStateFailedSchema,
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				taskId: "string > 0",
				taskState: taskStateAwaitingRetryRequestSchema,
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
	)
	.output(
		type({
			taskInfo: taskInfoSchema,
		})
	);

const setTaskStateV1: ContractProcedure<WorkflowRunSetTaskStateRequestV1, void> = oc
	.input(workflowRunSetTaskStateRequestSchema)
	.output(type("undefined"));

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
			"data?": "unknown",
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
			"data?": "unknown",
			"options?": {
				"reference?": { id: "string > 0" },
			},
		})
	)
	.output(type("undefined"));

const multicastEventByReferenceV1: ContractProcedure<WorkflowRunMulticastEventByReferenceRequestV1, void> = oc
	.input(
		type({
			references: type({
				name: "string > 0",
				versionId: "string > 0",
				referenceId: "string > 0",
			}).array(),
			eventName: "string > 0",
			"data?": "unknown",
			"options?": {
				"reference?": { id: "string > 0" },
			},
		})
	)
	.output(type("undefined"));

export const workflowRunContract = {
	listV1,
	getByIdV1,
	getByReferenceIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	transitionTaskStateV1,
	setTaskStateV1,
	listTransitionsV1,
	sendEventV1,
	multicastEventV1,
	multicastEventByReferenceV1,
};

export type WorkflowRunContract = typeof workflowRunContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowRunContract>, WorkflowRunApi>>;
