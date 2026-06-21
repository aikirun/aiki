import { delay } from "../async/delay";

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
	factor?: number;
	maxDelayMs?: number;
}

export type RetryStrategy = NeverRetryStrategy | FixedRetryStrategy | ExponentialRetryStrategy | JitteredRetryStrategy;

export type RetryOptions<Result, Abortable extends boolean> = {
	shouldRetryOnResult?: (previousResult: Result) => boolean | Promise<boolean>;
	shouldNotRetryOnError?: (error: unknown) => boolean | Promise<boolean>;
	onError?: (error: unknown) => void | Promise<void>;
} & (Abortable extends true ? { signal: AbortSignal } : { signal?: never });

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
	options?: RetryOptions<Result, false>
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | TimeoutResult> };
export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options: RetryOptions<Result, true>
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | TimeoutResult | AbortedResult> };
export function withRetry<Args, Result>(
	fn: (...args: Args[]) => Promise<Result>,
	strategy: RetryStrategy,
	options?: RetryOptions<Result, boolean>
): { run: (...args: Args[]) => Promise<CompletedResult<Result> | TimeoutResult | AbortedResult> } {
	const shouldRetryOnResult = options?.shouldRetryOnResult;
	const shouldNotRetryOnError = options?.shouldNotRetryOnError;
	const onError = options?.onError;

	return {
		run: async (...args: Args[]) => {
			let attempts = 0;

			while (true) {
				if (options?.signal?.aborted) {
					return {
						state: "aborted",
						reason: options.signal.reason,
					};
				}

				attempts++;

				let result: Result | undefined;

				try {
					result = await fn(...args);
					if (shouldRetryOnResult === undefined) {
						return {
							state: "completed",
							result,
							attempts,
						};
					}
					const maybeShouldRetry = shouldRetryOnResult(result);
					const shouldRetry = maybeShouldRetry instanceof Promise ? await maybeShouldRetry : maybeShouldRetry;
					if (!shouldRetry) {
						return {
							state: "completed",
							result,
							attempts,
						};
					}
				} catch (err) {
					if (onError) {
						const onErrorResult = onError(err);
						if (onErrorResult instanceof Promise) {
							await onErrorResult;
						}
					}
					if (shouldNotRetryOnError) {
						const maybeShouldNotRetry = shouldNotRetryOnError(err);
						const shouldNotRetry =
							maybeShouldNotRetry instanceof Promise ? await maybeShouldNotRetry : maybeShouldNotRetry;
						if (shouldNotRetry) {
							throw err;
						}
					}
				}

				const retryParams = getRetryParams(attempts, strategy);
				if (!retryParams.retriesLeft) {
					return {
						state: "timeout",
					};
				}

				await delay(retryParams.delayMs, { signal: options?.signal }).catch(() => {});
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
			const base = strategy.baseDelayMs * (strategy.factor ?? 2) ** (attempts - 1);
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
