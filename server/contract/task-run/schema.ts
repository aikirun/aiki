import { z } from "zod";
import type { TaskRunResult } from "@aiki/types/task-run";
import type { zT } from "../helpers/schema.ts";
import { serializedErrorSchema } from "../serializable.ts";

export const taskRunResultSchema: zT<TaskRunResult<unknown>> = z.discriminatedUnion(
	"state",
	[
		z.object({ state: z.literal("none") }),
		z.object({ state: z.literal("completed"), output: z.unknown() }),
		z.object({
			state: z.literal("failed"),
			reason: z.string(),
			attempts: z.number().int().positive(),
			attemptedAt: z.number(),
			nextAttemptAt: z.number().optional(),
			error: serializedErrorSchema.optional(),
		}),
	],
);
