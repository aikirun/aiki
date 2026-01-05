import type { EventQueue, EventState } from "@aikirun/types/event";
import { z } from "zod";

import type { Zt } from "../helpers/schema";

export const eventStateSchema: Zt<EventState<unknown>> = z.union([
	z.object({
		status: z.literal("received"),
		data: z.unknown(),
		receivedAt: z.number(),
		reference: z.object({ id: z.string().min(1) }).optional(),
	}),
	z.object({
		status: z.literal("timeout"),
		timedOutAt: z.number(),
	}),
]);

export const eventsQueueSchema: Zt<EventQueue<unknown>> = z.object({
	events: z.array(eventStateSchema),
});
