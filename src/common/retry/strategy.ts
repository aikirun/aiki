export type RetryStrategy =
	| { type: "never" }
	| { type: "fixed"; maxAttempts: number; delayMs: number }
	| { type: "exponential"; maxAttempts: number; baseDelayMs: number; factor: number }
	| { type: "jittered"; maxAttempts: number; baseDelayMs: number; jitterFactor: number };