import type { WorkflowName } from "@aiki/types/workflow";
import type { Client, SubscriberStrategy, SubscriberStrategyBuilder } from "@aiki/types/client";
import { createPollingStrategy } from "./polling.ts";
import { createAdaptivePollingStrategy } from "./adaptive-polling.ts";
import { createRedisStreamsStrategy } from "./redis-streams.ts";

export function resolveSubscriberStrategy(
	client: Client<unknown>,
	strategy: SubscriberStrategy,
	workflowNames: WorkflowName[],
	workerShards?: string[],
): SubscriberStrategyBuilder {
	switch (strategy.type) {
		case "polling":
			return createPollingStrategy(client, strategy);
		case "adaptive_polling":
			return createAdaptivePollingStrategy(client, strategy);
		case "redis_streams":
			return createRedisStreamsStrategy(client, strategy, workflowNames, workerShards);
		default:
			return strategy satisfies never;
	}
}
