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
	redisStreams: {
		getConnection: () => Redis;
		closeConnection: () => Promise<void>;
	};
}

class ClientImpl implements Client {
	private redisStreamsConnection?: Redis;
	public readonly redisStreams: Client["redisStreams"];

	constructor(
		public readonly workflowRunRepository: WorkflowRunRepository,
		private readonly params: ClientParams,
	) {
		this.redisStreams = {
			getConnection: () => this.getRedisStreamsConnection(),
			closeConnection: () => this.closeRedisStreamsConnection(),
		};
	}

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

	private getRedisStreamsConnection(): Redis {
		if (!this.redisStreamsConnection) {
			if (!this.params.redisStreams) {
				throw new Error(
					"Redis Streams configuration not provided to client. Add 'redisStreams' to ClientParams.",
				);
			}
			this.redisStreamsConnection = new Redis(this.params.redisStreams);
		}
		return this.redisStreamsConnection;
	}

	private async closeRedisStreamsConnection(): Promise<void> {
		if (this.redisStreamsConnection) {
			await this.redisStreamsConnection.quit();
			this.redisStreamsConnection = undefined;
		}
	}
}
