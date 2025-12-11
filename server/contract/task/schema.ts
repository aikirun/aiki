import { z } from "zod";
import type { TaskState } from "@aikirun/types/task";
import type { zT } from "../helpers/schema.ts";
import { serializedErrorSchema } from "../serializable.ts";

export const taskStateSchema: zT<TaskState<unknown>> = z.discriminatedUnion("status", [
	z.object({ status: z.literal("none") }),
	z.object({
		status: z.literal("running"),
		attempts: z.number().int().positive(),
	}),
	z.object({ status: z.literal("completed"), output: z.unknown() }),
	z.object({
		status: z.literal("failed"),
		reason: z.string(),
		attempts: z.number().int().positive(),
		attemptedAt: z.number(),
		nextAttemptAt: z.number().optional(),
		error: serializedErrorSchema.optional(),
	}),
]);
