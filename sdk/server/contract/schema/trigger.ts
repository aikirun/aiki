import { type } from "arktype";

import { durationObjectSchema } from "./duration";

export const triggerStrategySchema = type({
	type: "'immediate'",
})
	.or({
		type: "'delayed'",
		delayMs: "number.integer > 0",
	})
	.or({
		type: "'delayed'",
		delay: durationObjectSchema,
	});
