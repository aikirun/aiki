import { z } from "zod";
import type { TaskRunResult } from "./types.ts";
import type { zT } from "../common/schema.ts";

export const taskRunResultSchema: zT<TaskRunResult<unknown>> = z.discriminatedUnion(
	"state",
	[
		z.object({ state: z.literal("none") }),
		z.object({ state: z.literal("completed"), result: z.unknown() }),
		z.object({ state: z.literal("failed"), reason: z.string() }),
	],
);
