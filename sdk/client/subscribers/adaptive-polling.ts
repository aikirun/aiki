import { AdaptivePollingStrategy } from "@aikirun/lib/polling";
import type {
	AdaptivePollingSubscriberStrategy,
	Client,
	StrategyCallbacks,
	SubscriberDelayParams,
	SubscriberStrategyBuilder,
	WorkflowRunBatch,
} from "@aikirun/types/client";

export function createAdaptivePollingStrategy(
	_client: Client,
	strategy: AdaptivePollingSubscriberStrategy
): SubscriberStrategyBuilder {
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;

	const adaptive = new AdaptivePollingStrategy(strategy);

	const getNextDelay = (params: SubscriberDelayParams) => {
		switch (params.type) {
			case "polled":
				return params.foundWork ? adaptive.recordWorkFound() : adaptive.recordNoWork();
			case "retry":
				return adaptive.forceSlowPolling();
			case "heartbeat":
				return adaptive.recordNoWork();
			case "at_capacity":
				return atCapacityIntervalMs;
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
