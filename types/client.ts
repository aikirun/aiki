import type { WorkflowMeta } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow-run";
import type { WorkflowRunApi } from "@aikirun/types/workflow-run-api";

import { INTERNAL } from "./symbols";

export interface ClientParams<AppContext = unknown> {
	url: string;
	redis: RedisConfig;
	logger?: Logger;
	createContext?: (run: Readonly<WorkflowRun>) => AppContext | Promise<AppContext>;
}

export interface Client<AppContext = unknown> {
	api: ApiClient;
	logger: Logger;
	close: () => Promise<void>;
	[INTERNAL]: {
		subscriber: {
			create: (
				strategy: SubscriberStrategy,
				workflows: WorkflowMeta[],
				workerShards?: string[]
			) => SubscriberStrategyBuilder;
		};
		redis: RedisConnection;
		createContext?: (run: WorkflowRun) => AppContext | Promise<AppContext>;
	};
}

export interface Logger {
	trace(message: string, metadata?: Record<string, unknown>): void;
	debug(message: string, metadata?: Record<string, unknown>): void;
	info(message: string, metadata?: Record<string, unknown>): void;
	warn(message: string, metadata?: Record<string, unknown>): void;
	error(message: string, metadata?: Record<string, unknown>): void;
	child(bindings: Record<string, unknown>): Logger;
}

export interface ApiClient {
	workflowRun: WorkflowRunApi;
}

export interface RedisClient {
	xclaim(...args: unknown[]): Promise<unknown>;
	xack(stream: string, group: string, messageId: string): Promise<number>;
	xgroup(...args: unknown[]): Promise<unknown>;
	xreadgroup(...args: unknown[]): Promise<unknown>;
	xpending(...args: unknown[]): Promise<unknown>;
	quit(): Promise<unknown>;
}

export interface RedisConfig {
	host: string;
	port: number;
	password?: string;
	db?: number;
	maxRetriesPerRequest?: number;
	retryDelayOnFailoverMs?: number;
	connectTimeoutMs?: number;
}

export interface RedisConnection {
	getConnection: () => RedisClient;
	closeConnection: () => Promise<void>;
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

export type SubscriberDelayParams =
	| { type: "polled"; foundWork: boolean }
	| { type: "retry"; attemptNumber: number }
	| { type: "heartbeat" }
	| { type: "at_capacity" };

export interface ResolvedSubscriberStrategy {
	type: string;
	getNextDelay: (context: SubscriberDelayParams) => number;
	getNextBatch: (size: number) => Promise<WorkflowRunBatch[]>;
	heartbeat?: (workflowRunId: WorkflowRunId, meta: SubscriberMessageMeta) => Promise<void>;
	acknowledge?: (workflowRunId: WorkflowRunId, meta: SubscriberMessageMeta) => Promise<void>;
}

export interface PollingSubscriberStrategy {
	type: "polling";
	intervalMs?: number;
	maxRetryIntervalMs?: number;
	atCapacityIntervalMs?: number;
}

export interface AdaptivePollingSubscriberStrategy {
	type: "adaptive_polling";
	minPollIntervalMs?: number;
	maxPollIntervalMs?: number;
	backoffMultiplier?: number;
	emptyPollThreshold?: number;
	jitterFactor?: number;
	successResetThreshold?: number;
	atCapacityIntervalMs?: number;
}

export interface RedisStreamsSubscriberStrategy {
	type: "redis";
	intervalMs?: number;
	maxRetryIntervalMs?: number;
	atCapacityIntervalMs?: number;
	blockTimeMs?: number;
	claimMinIdleTimeMs?: number;
}

export type SubscriberStrategy = // | PollingSubscriberStrategy
	// | AdaptivePollingSubscriberStrategy
	RedisStreamsSubscriberStrategy;

export interface SubscriberStrategyBuilder {
	init: (workerId: string, callbacks: StrategyCallbacks) => Promise<ResolvedSubscriberStrategy>;
}

export interface StrategyCallbacks {
	onError?: (error: Error) => void;
	onStop?: () => Promise<void>;
}
