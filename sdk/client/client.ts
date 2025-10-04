import { initWorkflowRunRepository, type WorkflowRunRepository } from "../workflow/run/repository.ts";
import {
	resolveSubscriberStrategy,
	type SubscriberStrategy,
	type SubscriberStrategyBuilder,
} from "./subscribers/strategy-resolver.ts";
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
	redisStreams?: RedisConfig;
}

export interface Client {
	workflowRunRepository: WorkflowRunRepository;
	createSubscriberStrategy: (
		strategy: SubscriberStrategy,
		registry: WorkflowRegistry,
		workerShards?: string[],
	) => SubscriberStrategyBuilder;
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
	): SubscriberStrategyBuilder {
		return resolveSubscriberStrategy(this, strategy, registry, workerShards);
	}

	public getServerUrl(): string {
		return this.params.serverUrl;
	}

	public getRedisConnection(): Redis {
		if (!this.redisConnection) {
			if (!this.params.redisStreams) {
				throw new Error("Redis Streams configuration not provided to client. Add 'redisStreams' to ClientParams.");
			}
			this.redisConnection = new Redis(this.params.redisStreams);
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
