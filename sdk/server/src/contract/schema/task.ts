import { type } from "arktype";

import { retryStrategySchema } from "./retry";
import { serializedErrorSchema } from "./serializable";

export const taskOptionsSchema = type({
	"retry?": retryStrategySchema,
});

export const taskStateRunningSchema = type({
	status: "'running'",
	attempts: "number.integer > 0",
});

export const taskStateCompletedSchema = type({
	status: "'completed'",
	attempts: "number.integer > 0",
	output: "unknown",
});

export const taskStateFailedSchema = type({
	status: "'failed'",
	attempts: "number.integer > 0",
	error: serializedErrorSchema,
});

export const taskStateAwaitingRetrySchema = type({
	status: "'awaiting_retry'",
	attempts: "number.integer > 0",
	error: serializedErrorSchema,
	nextAttemptAt: "number > 0",
});

const nonDiscardedTaskStateSchema = taskStateRunningSchema
	.or(taskStateAwaitingRetrySchema)
	.or(taskStateCompletedSchema)
	.or(taskStateFailedSchema);

export const taskStateSchema = nonDiscardedTaskStateSchema.or({
	status: "'discarded'",
	attempts: "number.integer > 0",
});

export const taskInfoSchema = type({
	id: "string > 0",
	name: "string > 0",
	state: nonDiscardedTaskStateSchema,
	inputHash: "string > 0",
});

export const taskRecordSchema = type({
	id: "string > 0",
	name: "string > 0",
	workflowRunId: "string > 0",
	"input?": "unknown",
	inputHash: "string > 0",
	"options?": taskOptionsSchema.or("undefined"),
	state: taskStateSchema,
});

export const taskSetStateRequestSchema = type({
	type: "'new'",
	workflowRunId: "string > 0",
	taskName: "string > 0",
	"input?": "unknown",
	state: taskStateCompletedSchema.or(taskStateFailedSchema).omit("attempts"),
}).or({
	type: "'existing'",
	id: "string > 0",
	workflowRunId: "string > 0",
	state: taskStateCompletedSchema.or(taskStateFailedSchema).omit("attempts"),
});
