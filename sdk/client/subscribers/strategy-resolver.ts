import type { WorkflowName } from "@aiki/types/workflow";
import type { WorkflowRunId } from "@aiki/types/workflow-run";
import type { Client } from "../client.ts";
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

export interface SubscriberMessageMeta {
	stream: string;
	messageId: string;
	consumerGroup: string;
}

export interface WorkflowRunBatch {
	data: { workflowRunId: WorkflowRunId };
	meta?: SubscriberMessageMeta;
}

export interface ResolvedSubscriberStrategy {
	type: SubscriberStrategy["type"];
	getNextDelay: (context: SubscriberDelayParams) => number;
	getNextBatch: (size: number) => Promise<WorkflowRunBatch[]>;
	heartbeat?: (workflowRunId: WorkflowRunId, meta: SubscriberMessageMeta) => Promise<void>;
	acknowledge?: (workflowRunId: WorkflowRunId, meta: SubscriberMessageMeta) => Promise<void>;
}

export type SubscriberDelayParams =
	| { type: "polled"; foundWork: boolean }
	| { type: "retry"; attemptNumber: number }
	| { type: "heartbeat" }
	| { type: "at_capacity" };

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
