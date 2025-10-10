import type { WorkflowName } from "@aiki/contract/workflow";
import { Redis } from "redis";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { Contract } from "@aiki/contract";
import type { ContractRouterClient } from "@orpc/contract";
import {
	resolveSubscriberStrategy,
	type SubscriberStrategy,
	type SubscriberStrategyBuilder,
} from "./subscribers/strategy-resolver.ts";

export function client(params: ClientParams): Promise<Client> {
	return Promise.resolve(new ClientImpl(params));
}

export interface ClientParams {
	url: string;
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
	api: ContractRouterClient<Contract>;
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
	public readonly api: ContractRouterClient<Contract>;
	public readonly _internal: Client["_internal"];
	private redisStreamsConnection?: Redis;

	constructor(private readonly params: ClientParams) {
		const rpcLink = new RPCLink({
			url: `${params.url}`,
		});
		this.api = createORPCClient(rpcLink);

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
