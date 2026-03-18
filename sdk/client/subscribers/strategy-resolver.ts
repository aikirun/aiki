import type { Client, SubscriberStrategy, SubscriberStrategyBuilder } from "@aikirun/types/client";
import type { WorkflowMeta } from "@aikirun/types/workflow";

import { createDbStrategy } from "./db";
import { createRedisStreamsStrategy } from "./redis-streams";

export function resolveSubscriberStrategy(
	client: Client,
	strategy: SubscriberStrategy,
	workflows: WorkflowMeta[],
	workerShards?: string[]
): SubscriberStrategyBuilder {
	switch (strategy.type) {
		case "redis":
			return createRedisStreamsStrategy(client, strategy, workflows, workerShards);
		case "db":
			return createDbStrategy(client, strategy, workflows, workerShards);
		default:
			return strategy satisfies never;
	}
}
