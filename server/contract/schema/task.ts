import { type } from "arktype";

import { retryStrategySchema } from "./retry";
import { serializedErrorSchema } from "./serializable";

export const taskOptionsSchema = type({
	"retry?": retryStrategySchema,
	"reference?": { id: "string > 0" },
});

export const taskStateRunningRequestSchema = type({
	status: "'running'",
	attempts: "number.integer > 0",
	"input?": "unknown",
});

export const taskStateCompletedRequestSchema = type({
	status: "'completed'",
	attempts: "number.integer > 0",
	"output?": "unknown",
});

export const taskStateFailedSchema = type({
	status: "'failed'",
	attempts: "number.integer > 0",
	error: serializedErrorSchema,
});

export const taskStateAwaitingRetryRequestSchema = type({
	status: "'awaiting_retry'",
	attempts: "number.integer > 0",
	error: serializedErrorSchema,
	nextAttemptInMs: "number.integer > 0",
});

export const taskStateSchema = type({
	status: "'running'",
	attempts: "number.integer > 0",
	input: "unknown",
})
	.or({
		status: "'awaiting_retry'",
		attempts: "number.integer > 0",
		error: serializedErrorSchema,
		nextAttemptAt: "number > 0",
	})
	.or({
		status: "'completed'",
		attempts: "number.integer > 0",
		output: "unknown",
	})
	.or({
		status: "'failed'",
		attempts: "number.integer > 0",
		error: serializedErrorSchema,
	});

export const taskInfoSchema = type({
	id: "string > 0",
	name: "string > 0",
	state: taskStateSchema,
	inputHash: "string > 0",
});
