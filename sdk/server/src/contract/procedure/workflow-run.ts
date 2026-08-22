import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	WorkflowRunApi,
	WorkflowRunCancelByIdsRequestV1,
	WorkflowRunCancelByIdsResponseV1,
	WorkflowRunClaimReadyRequestV1,
	WorkflowRunClaimReadyResponseV1,
	WorkflowRunClaimRefreshRequestV1,
	WorkflowRunCreateRequestV1,
	WorkflowRunCreateResponseV1,
	WorkflowRunGetByIdRequestV1,
	WorkflowRunGetByIdResponseV1,
	WorkflowRunGetByReferenceIdRequestV1,
	WorkflowRunGetByReferenceIdResponseV1,
	WorkflowRunGetStateRequestV1,
	WorkflowRunGetStateResponseV1,
	WorkflowRunHasTerminatedRequestV1,
	WorkflowRunHasTerminatedResponseV1,
	WorkflowRunListChildRunsRequestV1,
	WorkflowRunListChildRunsResponseV1,
	WorkflowRunListRequestV1,
	WorkflowRunListResponseV1,
	WorkflowRunListTransitionsRequestV1,
	WorkflowRunListTransitionsResponseV1,
	WorkflowRunMulticastEventByReferenceRequestV1,
	WorkflowRunMulticastEventRequestV1,
	WorkflowRunMulticastEventResponseV1,
	WorkflowRunSendEventRequestV1,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
} from "@aikirun/types/api/workflow-run";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";
import { inputHashSchema } from "../schema/hash";
import { stateTransitionSchema } from "../schema/state-transition";
import { workflowSourceSchema } from "../schema/workflow";
import {
	cancelByIdsRequestSchema,
	cancelByIdsResponseSchema,
	listChildRunsRequestSchema,
	listChildRunsResponseSchema,
	multicastEventResponseSchema,
	workflowRunRecordSchema,
	workflowRunStateAwaitingChildWorkflowSchema,
	workflowRunStateAwaitingEventSchema,
	workflowRunStateAwaitingRetrySchema,
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
	workflowRunStateStalledSchema,
	workflowRunStatusSchema,
	workflowStartOptionsSchema,
} from "../schema/workflow-run";

const listV1: ContractProcedure<WorkflowRunListRequestV1, WorkflowRunListResponseV1> = oc
	.input(
		type({
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"filters?": {
				"id?": "string > 0 | undefined",
				"scheduleId?": "string > 0 | undefined",
				"status?": workflowRunStatusSchema.array(),
				"workflow?": type({
					name: "string > 0",
					source: workflowSourceSchema,
				})
					.or({
						name: "string > 0",
						source: workflowSourceSchema,
						versionId: "string > 0",
					})
					.or({
						name: "string > 0",
						source: workflowSourceSchema,
						versionId: "string > 0",
						referenceId: "string > 0",
					}),
			},
			"sort?": {
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
				"taskCounts?": type({
					completed: "number.integer >= 0",
					running: "number.integer >= 0",
					failed: "number.integer >= 0",
					awaiting_retry: "number.integer >= 0",
					discarded: "number.integer >= 0",
				}).or("undefined"),
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
			run: workflowRunRecordSchema,
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
			run: workflowRunRecordSchema,
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
			inputHash: inputHashSchema,
			"parent?": type({ workflowRunId: "string > 0", expectedRevision: "number.integer >= 0" }).or("undefined"),
			"options?": workflowStartOptionsSchema,
		})
	)
	.output(
		type({
			id: "string > 0",
		})
	);

const transitionStateV1: ContractProcedure<WorkflowRunTransitionStateRequestV1, WorkflowRunTransitionStateResponseV1> =
	oc
		.input(
			type({
				type: "'optimistic'",
				id: "string > 0",
				expectedRevision: "number.integer >= 0",
				state: workflowRunStateScheduledRequestOptimisticSchema
					.or(workflowRunStateQueuedSchema)
					.or(workflowRunStateRunningSchema)
					.or(workflowRunStateSleepingSchema.omit("wakeupAt").and({ durationMs: "number > 0" }))
					.or(
						workflowRunStateAwaitingEventSchema
							.omit("timeoutAt")
							.and({ "timeoutInMs?": "number.integer > 0 | undefined" })
					)
					.or(workflowRunStateAwaitingRetrySchema.omit("nextAttemptAt").and({ nextAttemptInMs: "number.integer > 0" }))
					.or(
						workflowRunStateAwaitingChildWorkflowSchema
							.omit("timeoutAt")
							.and({ "timeoutInMs?": "number.integer > 0 | undefined" })
					)
					.or(workflowRunStateCompletedSchema.omit("output").and({ "output?": "unknown" }))
					.or(workflowRunStateFailedSchema),
			}).or({
				type: "'pessimistic'",
				id: "string > 0",
				state: workflowRunStateScheduledRequestPessimisticSchema
					.or(workflowRunStatePausedSchema)
					.or(workflowRunStateStalledSchema)
					.or(workflowRunStateCancelledSchema),
			})
		)
		.output(
			type({
				revision: "number.integer >= 0",
				state: workflowRunStateSchema,
				attempts: "number.integer >= 0",
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
					order: "'asc' | 'desc'",
				},
			})
		)
		.output(
			type({
				transitions: stateTransitionSchema.array(),
				total: "number.integer >= 0",
			})
		);

const sendEventV1: ContractProcedure<WorkflowRunSendEventRequestV1, void> = oc
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
	.output(type("undefined"));

const multicastEventV1: ContractProcedure<WorkflowRunMulticastEventRequestV1, WorkflowRunMulticastEventResponseV1> = oc
	.input(
		type({
			ids: type("string > 0").array().atLeastLength(1).atMostLength(10),
			eventName: "string > 0",
			"data?": "unknown",
			"options?": {
				"reference?": { id: "string > 0" },
			},
		})
	)
	.output(multicastEventResponseSchema);

const multicastEventByReferenceV1: ContractProcedure<
	WorkflowRunMulticastEventByReferenceRequestV1,
	WorkflowRunMulticastEventResponseV1
> = oc
	.input(
		type({
			references: type({
				name: "string > 0",
				versionId: "string > 0",
				referenceId: "string > 0",
			})
				.array()
				.atLeastLength(1)
				.atMostLength(10),
			eventName: "string > 0",
			"data?": "unknown",
			"options?": {
				"reference?": { id: "string > 0" },
			},
		})
	)
	.output(multicastEventResponseSchema);

const listChildRunsV1: ContractProcedure<WorkflowRunListChildRunsRequestV1, WorkflowRunListChildRunsResponseV1> = oc
	.input(listChildRunsRequestSchema)
	.output(listChildRunsResponseSchema);

const cancelByIdsV1: ContractProcedure<WorkflowRunCancelByIdsRequestV1, WorkflowRunCancelByIdsResponseV1> = oc
	.input(cancelByIdsRequestSchema)
	.output(cancelByIdsResponseSchema);

const claimReadyV1: ContractProcedure<WorkflowRunClaimReadyRequestV1, WorkflowRunClaimReadyResponseV1> = oc
	.input(
		type({
			workflows: type({
				source: workflowSourceSchema,
				name: "string > 0",
				versionId: "string > 0",
			})
				.array()
				.atLeastLength(1),
			"pools?": type("string > 0").array().or("undefined"),
			limit: "number.integer > 0",
		})
	)
	.output(
		type({
			runs: type({ id: "string > 0" }).array(),
		})
	);

const claimRefreshV1: ContractProcedure<WorkflowRunClaimRefreshRequestV1, void> = oc
	.input(
		type({
			id: "string > 0",
		})
	)
	.output(type("undefined"));

const hasTerminatedV1: ContractProcedure<WorkflowRunHasTerminatedRequestV1, WorkflowRunHasTerminatedResponseV1> = oc
	.input(
		type({
			id: "string > 0",
			afterStateTransitionId: "string > 0",
		})
	)
	.output(
		type({
			terminated: "boolean",
			latestStateTransitionId: "string > 0",
		})
	);

export const workflowRunContract = {
	listV1,
	getByIdV1,
	getByReferenceIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	listTransitionsV1,
	sendEventV1,
	multicastEventV1,
	multicastEventByReferenceV1,
	listChildRunsV1,
	cancelByIdsV1,
	claimReadyV1,
	claimRefreshV1,
	hasTerminatedV1,
};

export type WorkflowRunContract = typeof workflowRunContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowRunContract>, WorkflowRunApi>>;
