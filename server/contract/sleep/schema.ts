import { z } from "zod";
import type { SleepState } from "@aikirun/types/sleep";
import type { Zt } from "../helpers/schema";

export const sleepStateSchema: Zt<SleepState> = z.discriminatedUnion("status", [
	z.object({ status: z.literal("none") }),
	z.object({
		status: z.literal("sleeping"),
		awakeAt: z.number(),
	}),
	z.object({
		status: z.literal("completed"),
		completedAt: z.number(),
	}),
]);
