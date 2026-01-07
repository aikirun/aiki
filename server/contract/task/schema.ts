import type {
	TaskInfo,
	TaskOptions,
	TaskState,
	TaskStateAwaitingRetryRequest,
	TaskStateCompleted,
	TaskStateFailed,
	TaskStateRunning,
} from "@aikirun/types/task";
import { z } from "zod";

import type { Zt } from "../helpers/schema";
import { serializedErrorSchema } from "../serializable";
import { retryStrategySchema } from "../shared/schema";

export const taskOptionsSchema: Zt<TaskOptions> = z.object({
	retry: retryStrategySchema.optional(),
	reference: z.object({ id: z.string().min(1) }).optional(),
});

export const taskStateRunningSchema: Zt<TaskStateRunning<unknown>> = z.object({
	status: z.literal("running"),
	attempts: z.number().int().positive(),
	input: z.unknown(),
});

export const taskStateCompletedSchema: Zt<TaskStateCompleted<unknown>> = z.object({
	status: z.literal("completed"),
	attempts: z.number().int().positive(),
	output: z.unknown(),
});

export const taskStateFailedSchema: Zt<TaskStateFailed> = z.object({
	status: z.literal("failed"),
	attempts: z.number().int().positive(),
	error: serializedErrorSchema,
});

export const taskStateAwaitingRetryRequestSchema: Zt<TaskStateAwaitingRetryRequest> = z.object({
	status: z.literal("awaiting_retry"),
	attempts: z.number().int().positive(),
	error: serializedErrorSchema,
	nextAttemptInMs: z.number().int().nonnegative(),
});

export const taskStateSchema: Zt<TaskState> = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("running"),
		attempts: z.number().int().positive(),
		input: z.unknown(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		attempts: z.number().int().positive(),
		error: serializedErrorSchema,
		nextAttemptAt: z.number(),
	}),
	z.object({ status: z.literal("completed"), attempts: z.number().int().positive(), output: z.unknown() }),
	z.object({
		status: z.literal("failed"),
		attempts: z.number().int().positive(),
		error: serializedErrorSchema,
	}),
]);

export const taskInfoSchema: Zt<TaskInfo> = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	state: taskStateSchema,
	inputHash: z.string(),
});
