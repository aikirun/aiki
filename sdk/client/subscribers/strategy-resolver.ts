import type { WorkflowId } from "@aikirun/types/workflow";
import type { Client, SubscriberStrategy, SubscriberStrategyBuilder } from "@aikirun/types/client";
import { createRedisStreamsStrategy } from "./redis-streams";

export function resolveSubscriberStrategy(
	client: Client<unknown>,
	strategy: SubscriberStrategy,
	workflowIds: WorkflowId[],
	workerShards?: string[]
): SubscriberStrategyBuilder {
	switch (strategy.type) {
		// case "polling":
		// 	return createPollingStrategy(client, strategy);
		// case "adaptive_polling":
		// 	return createAdaptivePollingStrategy(client, strategy);
		case "redis_streams":
			return createRedisStreamsStrategy(client, strategy, workflowIds, workerShards);
		default:
			return strategy.type satisfies never;
	}
}
