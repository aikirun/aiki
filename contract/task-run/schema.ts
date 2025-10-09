import { z } from "zod";
import type { TaskRunResult } from "./types.ts";

export const taskRunResultSchema: z.ZodType<TaskRunResult<unknown>, TaskRunResult<unknown>> = z.discriminatedUnion(
	"state",
	[
		z.object({ state: z.literal("none") }),
		z.object({ state: z.literal("completed"), result: z.unknown() }),
		z.object({ state: z.literal("failed"), reason: z.string() }),
	],
);
