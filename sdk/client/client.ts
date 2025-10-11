import type { ApiClient, Client, ClientParams, Logger } from "@aiki/types/client";
import { Redis } from "redis";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { resolveSubscriberStrategy } from "./subscribers/strategy-resolver.ts";
import { ConsoleLogger } from "./logger/mod.ts";

export function client<AppContext = null>(params: ClientParams<AppContext>): Promise<Client<AppContext>> {
	return Promise.resolve(new ClientImpl(params));
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
						this,
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
