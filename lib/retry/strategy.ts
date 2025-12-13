import { delay } from "../async/delay";
import type { RetryStrategy } from "@aikirun/types/retry";

export type WithRetryOptions<Result, Abortable extends boolean> = {
	shouldRetryOnResult?: (previousResult: Result) => Promise<boolean>;
	shouldNotRetryOnError?: (error: unknown) => Promise<boolean>;
} & (Abortable extends true ? { abortSignal: AbortSignal } : { abortSignal?: never });

type CompletedResult<Result> = {
	state: "completed";
	result: Result;
	attempts: number;
};

interface TimeoutResult {
	state: "timeout";
}

interface AbortedResult {
	state: "aborted";
	reason: unknown;
}

export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options?: WithRetryOptions<Result, false>
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | TimeoutResult> };
export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options: WithRetryOptions<Result, true>
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | TimeoutResult | AbortedResult> };
export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options?: WithRetryOptions<Result, boolean>
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | TimeoutResult | AbortedResult> } {
	return {
		run: async (...args: Args[]) => {
			let attempts = 0;

			while (true) {
				if (options?.abortSignal?.aborted) {
					return {
						state: "aborted",
						reason: options.abortSignal.reason,
					};
				}

				attempts++;

				let result: Result | undefined;

				try {
					result = await fn(...args);
					if (options?.shouldRetryOnResult === undefined || !(await options.shouldRetryOnResult(result))) {
						return {
							state: "completed",
							result,
							attempts,
						};
					}
				} catch (err) {
					if (options?.shouldNotRetryOnError !== undefined && (await options.shouldNotRetryOnError(err))) {
						throw err;
					}
				}

				const retryParams = getRetryParams(attempts, strategy);
				if (!retryParams.retriesLeft) {
					return {
						state: "timeout",
					};
				}

				await delay(retryParams.delayMs, { abortSignal: options?.abortSignal });
			}
		},
	};
}

export type RetryParams = { retriesLeft: false } | { retriesLeft: true; delayMs: number };

export function getRetryParams(attempts: number, strategy: RetryStrategy): RetryParams {
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
			const delayMs = strategy.baseDelayMs * (strategy.factor ?? 2) ** (attempts - 1);
			return {
				retriesLeft: true,
				delayMs: Math.min(delayMs, strategy.maxDelayMs ?? Number.POSITIVE_INFINITY),
			};
		}
		case "jittered": {
			if (attempts >= strategy.maxAttempts) {
				return {
					retriesLeft: false,
				};
			}
			const base = strategy.baseDelayMs * (strategy.jitterFactor ?? 2) ** (attempts - 1);
			const delayMs = Math.random() * base;
			return {
				retriesLeft: true,
				delayMs: Math.min(delayMs, strategy.maxDelayMs ?? Number.POSITIVE_INFINITY),
			};
		}
		default:
			return strategyType satisfies never;
	}
}
