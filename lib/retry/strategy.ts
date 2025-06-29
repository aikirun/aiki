import { delay } from "../async/delay.ts";

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
	factor?: number; // TODO: document default value
	maxDelayMs?: number;
}

export interface JitteredRetryStrategy {
	type: "jittered";
	maxAttempts: number;
	baseDelayMs: number;
	jitterFactor?: number; // TODO: document default value
	maxDelayMs?: number;
}

export type RetryStrategy =
	| NeverRetryStrategy
	| FixedRetryStrategy
	| ExponentialRetryStrategy
	| JitteredRetryStrategy;

export type WithRetryOptions<Result, Abortable extends boolean> = {
	shouldRetryOnResult?: (previousResult: Result) => Promise<boolean>,
	shouldNotRetryOnError?: (error: unknown) => Promise<boolean>,
} & (
	Abortable extends true ? { signal: AbortSignal } : { signal?: never }
);

type CompletedResult<Result> = {
	state: "completed";
	result: Result;
	attempts: number;
};

type AbortedResult = { 
	state: "aborted";
	reason: unknown;
};

export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options?: WithRetryOptions<Result, false>,
): { run: (...args: Args[]) => Promise<CompletedResult<Result>> };
export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options: WithRetryOptions<Result, true>,
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | AbortedResult> };
export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options?: WithRetryOptions<Result, boolean>,
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | AbortedResult> } {
	return {
		run: async (...args: Args[]) => {
			let attempts = 0;

			while (true) {
				if (options?.signal?.aborted) {
					return {
						state: "aborted",
						reason: options.signal.reason
					};
				}

				attempts++;

				let result: Result | undefined;
				let error: unknown;

				try {
					result = await fn(...args);
					if (
						options?.shouldRetryOnResult === undefined ||
						!(await options.shouldRetryOnResult(result))
					) {
						return {
							state: "completed",
							result,
							attempts
						};
					}
				} catch (err) {
					if (
						options?.shouldNotRetryOnError !== undefined &&
						(await options.shouldNotRetryOnError(err))
					) {
						throw err;
					}
					error = err;
				}

				const retryParams = getRetryParams(attempts, strategy);
				if (!retryParams.retriesLeft) {
					if (error) throw error;
					throw new Error("Retry allowance has been exhausted");
				}

				await delay(retryParams.delayMs, { signal: options?.signal });
			}
		},
	};
}

export type RetryParams =
	| { retriesLeft: false }
	| { retriesLeft: true; delayMs: number };

export function getRetryParams(
	attempts: number,
	strategy: RetryStrategy,
): RetryParams {
	const strategyType = strategy.type;
	switch (strategyType) {
		case "never":
			return {
				retriesLeft: false,
			};
		case "fixed":
			if (attempts >= strategy.maxAttempts) {
				return {
					retriesLeft: false,
				};
			}
			return {
				retriesLeft: true,
				delayMs: strategy.delayMs,
			};
		case "exponential": {
			if (attempts >= strategy.maxAttempts) {
				return {
					retriesLeft: false,
				};
			}
			const delayMs = strategy.baseDelayMs * Math.pow(strategy.factor ?? 2, attempts - 1);
			return {
				retriesLeft: true,
				delayMs: Math.min(delayMs, strategy.maxDelayMs ?? Infinity),
			};
		}
		case "jittered": {
			if (attempts >= strategy.maxAttempts) {
				return {
					retriesLeft: false,
				};
			}
			const base = strategy.baseDelayMs * Math.pow(strategy.jitterFactor ?? 2, attempts - 1);
			const delayMs = base / 2 + Math.random() * base / 2;
			return {
				retriesLeft: true,
				delayMs: Math.min(delayMs, strategy.maxDelayMs ?? Infinity),
			};
		}
		default:
			return strategyType satisfies never;
	}
}
