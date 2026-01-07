import type { RetryStrategy } from "@aikirun/lib/retry";
import type { DurationObject } from "@aikirun/types/duration";
import type { TriggerStrategy } from "@aikirun/types/trigger";
import { z } from "zod";

import type { Zt } from "../helpers/schema";

export const durationObjectSchema: Zt<DurationObject> = z.union([
	z.object({
		days: z.number(),
		hours: z.number().optional(),
		minutes: z.number().optional(),
		seconds: z.number().optional(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number(),
		minutes: z.number().optional(),
		seconds: z.number().optional(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number().optional(),
		minutes: z.number(),
		seconds: z.number().optional(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number().optional(),
		minutes: z.number().optional(),
		seconds: z.number(),
		milliseconds: z.number().optional(),
	}),
	z.object({
		days: z.number().optional(),
		hours: z.number().optional(),
		minutes: z.number().optional(),
		seconds: z.number().optional(),
		milliseconds: z.number(),
	}),
]);

export const triggerStrategySchema: Zt<TriggerStrategy> = z.union([
	z.object({ type: z.literal("immediate") }),
	z.object({ type: z.literal("delayed"), delayMs: z.number() }),
	z.object({ type: z.literal("delayed"), delay: durationObjectSchema }),
	z.object({ type: z.literal("startAt"), startAt: z.number() }),
]);

export const retryStrategySchema: Zt<RetryStrategy> = z.discriminatedUnion("type", [
	z.object({ type: z.literal("never") }),
	z.object({ type: z.literal("fixed"), maxAttempts: z.number(), delayMs: z.number() }),
	z.object({
		type: z.literal("exponential"),
		maxAttempts: z.number(),
		baseDelayMs: z.number(),
		maxDelayMs: z.number(),
	}),
	z.object({ type: z.literal("jittered"), maxAttempts: z.number(), baseDelayMs: z.number(), maxDelayMs: z.number() }),
]);
