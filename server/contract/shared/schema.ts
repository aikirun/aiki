import type { DurationObject } from "@aikirun/types/duration";
import { type } from "arktype";

export const durationObjectSchema = type({
	"days?": "number.integer > 0 | undefined",
	"hours?": "number.integer > 0 | undefined",
	"minutes?": "number.integer > 0 | undefined",
	"seconds?": "number.integer > 0 | undefined",
	"milliseconds?": "number.integer > 0 | undefined",
}).narrow((obj): obj is DurationObject => {
	return (
		obj.days !== undefined ||
		obj.hours !== undefined ||
		obj.minutes !== undefined ||
		obj.seconds !== undefined ||
		obj.milliseconds !== undefined
	);
});

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
	})
	.or({
		type: "'startAt'",
		startAt: "number",
	});

export const retryStrategySchema = type({
	type: "'never'",
})
	.or({
		type: "'fixed'",
		maxAttempts: "number.integer > 0",
		delayMs: "number.integer > 0",
	})
	.or({
		type: "'exponential'",
		maxAttempts: "number.integer > 0",
		baseDelayMs: "number.integer > 0",
		maxDelayMs: "number.integer > 0",
	})
	.or({
		type: "'jittered'",
		maxAttempts: "number.integer > 0",
		baseDelayMs: "number.integer > 0",
		maxDelayMs: "number.integer > 0",
	});
