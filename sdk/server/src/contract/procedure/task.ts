import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	TaskApi,
	TaskGetByIdRequestV1,
	TaskGetByIdResponseV1,
	TaskSetStateRequestV1,
	TaskTransitionStateRequestV1,
	TaskTransitionStateResponseV1,
} from "@aikirun/types/api/task";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";
import {
	taskInfoSchema,
	taskOptionsSchema,
	taskRecordSchema,
	taskSetStateRequestSchema,
	taskStateAwaitingRetrySchema,
	taskStateCompletedSchema,
	taskStateFailedSchema,
} from "../schema/task";

const getByIdV1: ContractProcedure<TaskGetByIdRequestV1, TaskGetByIdResponseV1> = oc
	.input(
		type({
			id: "string > 0",
		})
	)
	.output(
		type({
			task: taskRecordSchema,
		})
	);

const transitionStateV1: ContractProcedure<TaskTransitionStateRequestV1, TaskTransitionStateResponseV1> = oc
	.input(
		type({
			type: "'create'",
			workflowRunId: "string > 0",
			taskName: "string > 0",
			"options?": taskOptionsSchema,
			"input?": "unknown",
			inputHash: "string > 0",
			expectedWorkflowRunRevision: "number.integer >= 0",
		})
			.or({
				type: "'retry'",
				id: "string > 0",
				workflowRunId: "string > 0",
				attempts: "number.integer > 0",
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				workflowRunId: "string > 0",
				attempts: "number.integer > 0",
				taskState: taskStateCompletedSchema.omit("output").and({ "output?": "unknown" }),
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				workflowRunId: "string > 0",
				attempts: "number.integer > 0",
				taskState: taskStateFailedSchema,
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
			.or({
				id: "string > 0",
				workflowRunId: "string > 0",
				attempts: "number.integer > 0",
				taskState: taskStateAwaitingRetrySchema.omit("nextAttemptAt").and({ nextAttemptInMs: "number.integer > 0" }),
				expectedWorkflowRunRevision: "number.integer >= 0",
			})
	)
	.output(
		type({
			taskInfo: taskInfoSchema,
		})
	);

const setStateV1: ContractProcedure<TaskSetStateRequestV1, void> = oc
	.input(taskSetStateRequestSchema)
	.output(type("undefined"));

export const taskContract = {
	getByIdV1,
	transitionStateV1,
	setStateV1,
};

export type TaskContract = typeof taskContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<TaskContract>, TaskApi>>;
