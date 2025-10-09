import { z } from "zod";

export type TriggerStrategy =
	| { type: "immediate" }
	| { type: "delayed"; delayMs: number }
	| { type: "startAt"; startAt: number; };

export const triggerStrategySchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("immediate") }),
	z.object({ type: z.literal("delayed"), delayMs: z.number() }),
	z.object({ type: z.literal("startAt"), startAt: z.number() }),
]);
