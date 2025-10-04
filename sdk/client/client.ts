import type { WorkflowName } from "@aiki/types/workflow";
import { Redis } from "redis";
import { type ApiClient, apiClient } from "@aiki/server";
import { resolveSubscriberStrategy, type SubscriberStrategy, type SubscriberStrategyBuilder } from "@aiki/sdk/client";

export function client(params: ClientParams): Promise<Client> {
	return Promise.resolve(new ClientImpl(params));
}

export interface ClientParams {
	baseUrl: string;
	redisStreams?: RedisConfig;
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

export interface Client {
	api: ApiClient;
	_internal: {
		subscriber: {
			create: (
				strategy: SubscriberStrategy,
				workflowNames: WorkflowName[],
				workerShards?: string[],
			) => SubscriberStrategyBuilder;
		};
		redisStreams: {
			getConnection: () => Redis;
			closeConnection: () => Promise<void>;
		};
	};
}

class ClientImpl implements Client {
	public readonly api: ApiClient;
	public readonly _internal: Client["_internal"];
	private redisStreamsConnection?: Redis;

	constructor(private readonly params: ClientParams) {
		this.api = apiClient({ baseUrl: params.baseUrl });
		this._internal = {
			subscriber: {
				create: (strategy, workflowNames, workerShards) =>
					resolveSubscriberStrategy(this, strategy, workflowNames, workerShards),
			},
			redisStreams: {
				getConnection: () => this.getRedisStreamsConnection(),
				closeConnection: () => this.closeRedisStreamsConnection(),
			},
		};
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
