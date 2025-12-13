export interface NeverRetryStrategy {
	type: "never";
}

export interface FixedRetryStrategy {
	type: "fixed";
	maxAttempts: number;
	delayMs: number;
}

export interface ExponentialRetryStrategy {
	type: "exponential";
	maxAttempts: number;
	baseDelayMs: number;
	factor?: number;
	maxDelayMs?: number;
}

export interface JitteredRetryStrategy {
	type: "jittered";
	maxAttempts: number;
	baseDelayMs: number;
	jitterFactor?: number;
	maxDelayMs?: number;
}

export type RetryStrategy = NeverRetryStrategy | FixedRetryStrategy | ExponentialRetryStrategy | JitteredRetryStrategy;
