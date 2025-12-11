import { getRetryParams } from "../retry/index.ts";

export interface AdaptivePollingConfig {
	/**
	 * Minimum polling interval when busy (ms)
	 * @default 50
	 */
	minPollIntervalMs?: number;

	/**
	 * Maximum polling interval when idle (ms)
	 * @default 5000
	 */
	maxPollIntervalMs?: number;

	/**
	 * Multiplier for backing off when no work found
	 * @default 1.5
	 */
	backoffMultiplier?: number;

	/**
	 * Number of consecutive empty polls before starting backoff
	 * @default 3
	 */
	emptyPollThreshold?: number;

	/**
	 * Jitter factor to prevent thundering herd (0-1)
	 * @default 0.1
	 */
	jitterFactor?: number;

	/**
	 * Reset to fast polling after this many successful work fetches
	 * @default 1
	 */
	successResetThreshold?: number;
}

export class AdaptivePollingStrategy {
	private readonly config: Required<AdaptivePollingConfig>;
	private currentIntervalMs: number;
	private consecutiveEmptyPolls = 0;
	private consecutiveSuccessfulPolls = 0;

	constructor(config: AdaptivePollingConfig) {
		this.config = {
			minPollIntervalMs: config.minPollIntervalMs ?? 50,
			maxPollIntervalMs: config.maxPollIntervalMs ?? 5_000,
			backoffMultiplier: config.backoffMultiplier ?? 1.5,
			emptyPollThreshold: config.emptyPollThreshold ?? 3,
			jitterFactor: config.jitterFactor ?? 0.1,
			successResetThreshold: config.successResetThreshold ?? 1,
		};
		this.currentIntervalMs = this.config.minPollIntervalMs;
	}

	/**
	 * Records that work was found and returns the next polling interval
	 */
	recordWorkFound(): number {
		this.consecutiveEmptyPolls = 0;
		this.consecutiveSuccessfulPolls++;

		if (this.consecutiveSuccessfulPolls >= this.config.successResetThreshold) {
			this.currentIntervalMs = this.config.minPollIntervalMs;
		}

		return this.getNextIntervalWithJitter();
	}

	/**
	 * Records that no work was found and returns the next polling interval
	 */
	recordNoWork(): number {
		this.consecutiveEmptyPolls++;
		this.consecutiveSuccessfulPolls = 0;

		if (this.consecutiveEmptyPolls > this.config.emptyPollThreshold) {
			const backoffAttempts = this.consecutiveEmptyPolls - this.config.emptyPollThreshold;
			const retryParams = getRetryParams(backoffAttempts, {
				type: "exponential",
				maxAttempts: Infinity,
				baseDelayMs: this.config.minPollIntervalMs,
				factor: this.config.backoffMultiplier,
				maxDelayMs: this.config.maxPollIntervalMs,
			});

			if (retryParams.retriesLeft) {
				this.currentIntervalMs = retryParams.delayMs;
			}
		}

		return this.getNextIntervalWithJitter();
	}

	/**
	 * Resets the strategy to fast polling (useful for external triggers)
	 */
	reset(): number {
		this.consecutiveEmptyPolls = 0;
		this.consecutiveSuccessfulPolls = 0;
		this.currentIntervalMs = this.config.minPollIntervalMs;
		return this.getNextIntervalWithJitter();
	}

	/**
	 * Forces the strategy to slow polling (useful for rate limiting)
	 */
	forceSlowPolling(): number {
		this.currentIntervalMs = this.config.maxPollIntervalMs;
		return this.getNextIntervalWithJitter();
	}

	/**
	 * Gets the current polling interval without changing state
	 */
	getCurrentInterval(): number {
		return this.getNextIntervalWithJitter();
	}

	/**
	 * Gets polling statistics for monitoring
	 */
	getStats(): AdaptivePollingStats {
		return {
			currentIntervalMs: this.currentIntervalMs,
			consecutiveEmptyPolls: this.consecutiveEmptyPolls,
			consecutiveSuccessfulPolls: this.consecutiveSuccessfulPolls,
			isInBackoffMode: this.consecutiveEmptyPolls > this.config.emptyPollThreshold,
			config: this.config,
		};
	}

	private getNextIntervalWithJitter(): number {
		const jitter = 1 + (Math.random() - 0.5) * 2 * this.config.jitterFactor;
		return Math.max(1, Math.round(this.currentIntervalMs * jitter));
	}
}

export interface AdaptivePollingStats {
	currentIntervalMs: number;
	consecutiveEmptyPolls: number;
	consecutiveSuccessfulPolls: number;
	isInBackoffMode: boolean;
	config: Required<AdaptivePollingConfig>;
}
