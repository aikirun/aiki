import { initWorkflowRunRepository, type WorkflowRunRepository } from "../workflow/run/repository.ts";
import {
	type ResolvedSubscriberStrategy,
	resolveSubscriberStrategy,
	type SubscriberStrategy,
	type SubscriberStrategyBuilder,
} from "./strategies/subscriber-strategies.ts";
import type { WorkflowRegistry } from "../workflow/registry.ts";
import { Redis } from "redis";

export async function client(params: ClientParams): Promise<Client> {
	const workflowRunRepository = await initWorkflowRunRepository();
	return Promise.resolve(new ClientImpl(workflowRunRepository, params));
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

export interface ClientParams {
	serverUrl: string;
	redis?: RedisConfig;
}

export interface Client {
	workflowRunRepository: WorkflowRunRepository;
	createSubscriberStrategy: (
		strategy: SubscriberStrategy,
		registry: WorkflowRegistry,
		workerShards?: string[],
	) => SubscriberStrategyBuilder<ResolvedSubscriberStrategy>;
	getServerUrl: () => string;
	getRedisConnection: () => Redis;
}

class ClientImpl implements Client {
	private redisConnection?: Redis;

	constructor(
		public readonly workflowRunRepository: WorkflowRunRepository,
		private readonly params: ClientParams,
	) {}

	public createSubscriberStrategy(
		strategy: SubscriberStrategy,
		registry: WorkflowRegistry,
		workerShards?: string[],
	): SubscriberStrategyBuilder<ResolvedSubscriberStrategy> {
		return resolveSubscriberStrategy(this, strategy, registry, workerShards);
	}

	public getServerUrl(): string {
		return this.params.serverUrl;
	}

	public getRedisConnection(): Redis {
		if (!this.redisConnection) {
			if (!this.params.redis) {
				throw new Error("Redis configuration not provided to client. Add 'redis' to ClientParams.");
			}
			this.redisConnection = new Redis(this.params.redis);
		}
		return this.redisConnection;
	}

	public async closeRedisConnection(): Promise<void> {
		if (this.redisConnection) {
			await this.redisConnection.quit();
			this.redisConnection = undefined;
		}
	}
}
