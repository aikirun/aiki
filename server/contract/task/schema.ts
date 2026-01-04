import type { TaskInfo, TaskState } from "@aikirun/types/task";
import type { TaskStateRequest } from "@aikirun/types/workflow-run-api";
import { z } from "zod";

import type { Zt } from "../helpers/schema";
import { serializedErrorSchema } from "../serializable";

export const taskStateRequestSchema: Zt<TaskStateRequest> = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("running"),
		attempts: z.number().int().positive(),
		input: z.unknown(),
	}),
	z.object({
		status: z.literal("awaiting_retry"),
		attempts: z.number().int().positive(),
		error: serializedErrorSchema,
		nextAttemptInMs: z.number().int().nonnegative(),
	}),
	z.object({ status: z.literal("completed"), attempts: z.number().int().positive(), output: z.unknown() }),
	z.object({
		status: z.literal("failed"),
		attempts: z.number().int().positive(),
		error: serializedErrorSchema,
	}),
]);

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
	state: taskStateSchema,
	inputHash: z.string(),
});
