import type { WorkflowName } from "@aiki/contract/workflow";
import type { WorkflowRun } from "@aiki/contract/workflow-run";
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
import type { Logger } from "../logger/mod.ts";
import { ConsoleLogger } from "../logger/mod.ts";

export function client<AppContext = null>(params: ClientParams<AppContext>): Promise<Client<AppContext>> {
	return Promise.resolve(new ClientImpl(params));
}

export interface ClientParams<AppContext> {
	url: string;
	redisStreams?: RedisConfig;
	logger?: Logger;
	contextFactory?: (run: WorkflowRun<unknown, unknown>) => AppContext | Promise<AppContext>;
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

export type ApiClient = ContractRouterClient<Contract>;

export interface RedisStreamsConnection {
	getConnection: () => Redis;
	closeConnection: () => Promise<void>;
}

export interface Client<AppContext> {
	api: ApiClient;
	_internal: {
		subscriber: {
			create: (
				strategy: SubscriberStrategy,
				workflowNames: WorkflowName[],
				workerShards?: string[],
			) => SubscriberStrategyBuilder;
		};
		redisStreams: RedisStreamsConnection;
		logger: Logger;
		contextFactory?: (run: WorkflowRun<unknown, unknown>) => AppContext | Promise<AppContext>;
	};
}

class ClientImpl<AppContext> implements Client<AppContext> {
	public readonly api: ApiClient;
	public readonly _internal: Client<AppContext>["_internal"];
	private readonly logger: Logger;
	private redisStreamsConnection?: Redis;

	constructor(private readonly params: ClientParams<AppContext>) {
		this.logger = params.logger ?? new ConsoleLogger();

		const rpcLink = new RPCLink({
			url: `${params.url}`,
		});
		this.api = createORPCClient(rpcLink);

		this.logger.info("Aiki client initialized", {
			"aiki.url": params.url,
		});

		this._internal = {
			subscriber: {
				create: (strategy, workflowNames, workerShards) =>
					resolveSubscriberStrategy(
						this.api,
						this._internal.redisStreams,
						strategy,
						workflowNames,
						workerShards,
					),
			},
			redisStreams: {
				getConnection: () => this.getRedisStreamsConnection(),
				closeConnection: () => this.closeRedisStreamsConnection(),
			},
			logger: this.logger,
			contextFactory: this.params.contextFactory,
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
