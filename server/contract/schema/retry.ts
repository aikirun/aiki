import { type } from "arktype";

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
		"factor?": "number.integer > 0 | undefined",
		"maxDelayMs?": "number.integer > 0 | undefined",
	})
	.or({
		type: "'jittered'",
		maxAttempts: "number.integer > 0",
		baseDelayMs: "number.integer > 0",
		"jitterFactor?": "number.integer > 0 | undefined",
		"maxDelayMs?": "number.integer > 0 | undefined",
	});
