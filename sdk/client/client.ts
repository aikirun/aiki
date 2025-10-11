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
	private redisConnection?: Redis;

	constructor(private readonly params: ClientParams<AppContext>) {
		this.logger = params.logger ?? new ConsoleLogger();

		const rpcLink = new RPCLink({ url: `${params.url}` });
		// Type safety: The server package has compile-time tests (see server/contract/workflow-run/procedure.ts)
		// that verify the contract matches WorkflowRunApi. If the contract changes, server won't compile.
		this.api = createORPCClient(rpcLink) as unknown as ApiClient;

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
			redis: {
				getConnection: () => this.getRedisConnection(),
				closeConnection: () => this.closeRedisConnection(),
			},
			logger: this.logger,
			contextFactory: this.params.contextFactory,
		};
	}

	public async close(): Promise<void> {
		this.logger.info("Closing Aiki client");
		await this.closeRedisConnection();
	}

	private getRedisConnection(): Redis {
		if (!this.redisConnection) {
			if (!this.params.redis) {
				throw new Error(
					"Redis configuration not provided to client. Add 'redis' to ClientParams.",
				);
			}
			this.redisConnection = new Redis(this.params.redis);
		}
		return this.redisConnection;
	}

	private async closeRedisConnection(): Promise<void> {
		if (this.redisConnection) {
			await this.redisConnection.quit();
			this.redisConnection = undefined;
		}
	}
}
