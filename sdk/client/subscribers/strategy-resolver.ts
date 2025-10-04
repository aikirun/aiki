import type { Client } from "../client.ts";
import type { WorkflowName } from "../../workflow/workflow.ts";
import type { WorkflowRunId } from "../../workflow/run/repository.ts";
import { createPollingStrategy, type PollingSubscriberStrategy } from "./polling.ts";
import { type AdaptivePollingSubscriberStrategy, createAdaptivePollingStrategy } from "./adaptive-polling.ts";
import { createRedisStreamsStrategy, type RedisStreamsSubscriberStrategy } from "./redis-streams.ts";

export type SubscriberStrategy =
	| PollingSubscriberStrategy
	| AdaptivePollingSubscriberStrategy
	| RedisStreamsSubscriberStrategy;

export interface SubscriberStrategyBuilder {
	init(workerId: string, callbacks: StrategyCallbacks): Promise<ResolvedSubscriberStrategy>;
}

export interface StrategyCallbacks {
	onError?: (error: Error) => void;
	onStop?: () => Promise<void>;
}

export interface ResolvedSubscriberStrategy {
	type: SubscriberStrategy["type"];
	getNextDelay(context: SubscriberDelayContext): number;
	getNextBatch(size: number): Promise<WorkflowRunId[]>;
}

export type SubscriberDelayContext =
	| { type: "polled"; foundWork: boolean }
	| { type: "retry"; attemptNumber: number }
	| { type: "heartbeat" }
	| { type: "at_capacity" };

export function resolveSubscriberStrategy(
	client: Client,
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
