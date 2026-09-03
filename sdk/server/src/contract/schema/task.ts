import { type } from "arktype";

import { opaquePayloadSchema } from "./payload";
import { retryStrategySchema } from "./retry";
import { serializedErrorSchema } from "./serializable";

export const taskOptionsSchema = type({
	"retry?": retryStrategySchema,
});

export const taskStateRunningSchema = type({
	status: "'running'",
});

export const taskStateAwaitingRetrySchema = type({
	status: "'awaiting_retry'",
	error: serializedErrorSchema,
	nextAttemptAt: "number > 0",
});

export const taskStateCompletedSchema = type({
	status: "'completed'",
	output: opaquePayloadSchema,
});

export const taskStateFailedSchema = type({
	status: "'failed'",
	error: serializedErrorSchema,
});

const taskStateDiscardedSchema = type({
	status: "'discarded'",
});

const nonDiscardedTaskStateSchema = taskStateRunningSchema
	.or(taskStateAwaitingRetrySchema)
	.or(taskStateCompletedSchema)
	.or(taskStateFailedSchema);

export const taskStateSchema = nonDiscardedTaskStateSchema.or(taskStateDiscardedSchema);

export const taskInfoSchema = type({
	id: "string > 0",
	name: "string > 0",
	state: nonDiscardedTaskStateSchema,
	inputHash: "string > 0",
	"options?": taskOptionsSchema.or("undefined"),
	attempts: "number.integer > 0",
});

export const taskRecordSchema = type({
	id: "string > 0",
	name: "string > 0",
	workflowRunId: "string > 0",
	"input?": opaquePayloadSchema,
	inputHash: "string > 0",
	"options?": taskOptionsSchema.or("undefined"),
	attempts: "number.integer > 0",
	state: taskStateSchema,
});

export const taskSetStateRequestSchema = type({
	id: "string > 0",
	workflowRunId: "string > 0",
	state: taskStateCompletedSchema.or(taskStateFailedSchema),
});
