import type { WorkflowName } from "@aiki/contract/workflow";
import type { WorkflowRunId } from "@aiki/contract/workflow-run";
import type { ApiClient, RedisStreamsConnection } from "../client.ts";
import type { PollingSubscriberStrategy } from "./polling.ts";
import type { AdaptivePollingSubscriberStrategy } from "./adaptive-polling.ts";
import type { RedisStreamsSubscriberStrategy } from "./redis-streams.ts";
import { createPollingStrategy } from "./polling.ts";
import { createAdaptivePollingStrategy } from "./adaptive-polling.ts";
import { createRedisStreamsStrategy } from "./redis-streams.ts";

export type SubscriberStrategy =
	| PollingSubscriberStrategy
	| AdaptivePollingSubscriberStrategy
	| RedisStreamsSubscriberStrategy;

export interface SubscriberStrategyBuilder {
	init: (workerId: string, callbacks: StrategyCallbacks) => Promise<ResolvedSubscriberStrategy>;
}

export interface StrategyCallbacks {
	onError?: (error: Error) => void;
	onStop?: () => Promise<void>;
}

export interface ResolvedSubscriberStrategy {
	type: SubscriberStrategy["type"];
	getNextDelay: (context: SubscriberDelayParams) => number;
	getNextBatch: (size: number) => Promise<WorkflowRunId[]>;
}

export type SubscriberDelayParams =
	| { type: "polled"; foundWork: boolean }
	| { type: "retry"; attemptNumber: number }
	| { type: "heartbeat" }
	| { type: "at_capacity" };

export function resolveSubscriberStrategy(
	api: ApiClient,
	redisStreams: RedisStreamsConnection,
	strategy: SubscriberStrategy,
	workflowNames: WorkflowName[],
	workerShards?: string[],
): SubscriberStrategyBuilder {
	switch (strategy.type) {
		case "polling":
			return createPollingStrategy(api, strategy);
		case "adaptive_polling":
			return createAdaptivePollingStrategy(api, strategy);
		case "redis_streams":
			return createRedisStreamsStrategy(redisStreams, strategy, workflowNames, workerShards);
		default:
			return strategy satisfies never;
	}
}
