import { type AdaptivePollingConfig, AdaptivePollingStrategy } from "@aiki/lib/polling";
import type { Client } from "../client.ts";
import type { StrategyCallbacks, SubscriberDelayContext, SubscriberStrategyBuilder } from "./strategy-resolver.ts";

/**
 * Adaptive polling subscriber strategy configuration
 */
export interface AdaptivePollingSubscriberStrategy extends AdaptivePollingConfig {
	type: "adaptive_polling";

	/**
	 * Polling interval when at capacity (milliseconds)
	 * @default 50
	 */
	atCapacityIntervalMs?: number;
}

export function createAdaptivePollingStrategy(
	client: Client,
	strategy: AdaptivePollingSubscriberStrategy,
): SubscriberStrategyBuilder {
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;

	const adaptive = new AdaptivePollingStrategy(strategy);

	const getNextDelay = (ctx: SubscriberDelayContext) => {
		switch (ctx.type) {
			case "polled":
				return ctx.foundWork ? adaptive.recordWorkFound() : adaptive.recordNoWork();
			case "retry":
				return adaptive.forceSlowPolling();
			case "heartbeat":
				return adaptive.recordNoWork();
			case "at_capacity":
				return atCapacityIntervalMs;
			default:
				return ctx satisfies never;
		}
	};

	const getNextBatch = (size: number) => client.api.workflowRun.getReadyIdsV1.query({ size });

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
