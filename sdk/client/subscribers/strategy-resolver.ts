import type { Client, SubscriberStrategy, SubscriberStrategyBuilder } from "@aikirun/types/client";
import type { WorkflowMeta } from "@aikirun/types/workflow";

import { createRedisStreamsStrategy } from "./redis-streams";

export function resolveSubscriberStrategy(
	client: Client,
	strategy: SubscriberStrategy,
	workflows: WorkflowMeta[],
	workerShards?: string[]
): SubscriberStrategyBuilder {
	switch (strategy.type) {
		// case "polling":
		// 	return createPollingStrategy(client, strategy);
		// case "adaptive_polling":
		// 	return createAdaptivePollingStrategy(client, strategy);
		case "redis":
			return createRedisStreamsStrategy(client, strategy, workflows, workerShards);
		default:
			return strategy.type satisfies never;
	}
}
