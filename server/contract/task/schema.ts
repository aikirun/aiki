import type { TaskState } from "@aikirun/types/task";
import { z } from "zod";

import type { Zt } from "../helpers/schema";
import { serializedErrorSchema } from "../serializable";

export const taskStateSchema: Zt<TaskState<unknown>> = z.discriminatedUnion("status", [
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
