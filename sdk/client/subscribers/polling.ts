import { getRetryParams } from "@aikirun/lib/retry";
import type {
	Client,
	PollingSubscriberStrategy,
	StrategyCallbacks,
	SubscriberDelayParams,
	SubscriberStrategyBuilder,
	WorkflowRunBatch,
} from "@aikirun/types/client";

export function createPollingStrategy(
	_client: Client<unknown>,
	strategy: PollingSubscriberStrategy
): SubscriberStrategyBuilder {
	const intervalMs = strategy.intervalMs ?? 100;
	const maxRetryIntervalMs = strategy.maxRetryIntervalMs ?? 30_000;
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;

	const getNextDelay = (params: SubscriberDelayParams) => {
		switch (params.type) {
			case "polled":
			case "heartbeat":
				return intervalMs;
			case "at_capacity":
				return atCapacityIntervalMs;
			case "retry": {
				const retryParams = getRetryParams(params.attemptNumber, {
					type: "jittered",
					maxAttempts: Infinity,
					baseDelayMs: intervalMs,
					maxDelayMs: maxRetryIntervalMs,
				});
				if (!retryParams.retriesLeft) {
					return maxRetryIntervalMs;
				}
				return retryParams.delayMs;
			}
			default:
				return params satisfies never;
		}
	};

	const getNextBatch = (_size: number): Promise<WorkflowRunBatch[]> => {
		return Promise.resolve([]);
	};

	return {
		init(_workerId: string, _callbacks: StrategyCallbacks) {
			return Promise.resolve({
				type: strategy.type,
				getNextDelay,
				getNextBatch,
			});
		},
	};
}
