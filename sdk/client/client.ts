import type { ApiClient, Client, ClientParams, Logger } from "@aikirun/types/client";
import { Redis } from "ioredis";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { resolveSubscriberStrategy } from "./subscribers/strategy-resolver";
import { ConsoleLogger } from "./logger/index";

/**
 * Creates an Aiki client for starting and managing workflows.
 *
 * The client connects to the Aiki server via HTTP and Redis for state management.
 * It provides methods to start workflows and monitor their execution.
 *
 * @template AppContext - Type of application context passed to workflows (default: null)
 * @param params - Client configuration parameters
 * @param params.url - HTTP URL of the Aiki server (e.g., "http://localhost:9090")
 * @param params.redis - Redis connection configuration
 * @param params.redis.host - Redis server hostname
 * @param params.redis.port - Redis server port
 * @param params.redis.password - Optional Redis password
 * @param params.contextFactory - Optional function to create context for each workflow run
 * @param params.logger - Optional custom logger (defaults to ConsoleLogger)
 * @returns Promise resolving to a configured Client instance
 *
 * @example
 * ```typescript
 * const client = await client({
 *   url: "http://localhost:9090",
 *   redis: { host: "localhost", port: 6379 },
 *   contextFactory: (run) => ({
 *     traceId: generateTraceId(),
 *     userId: extractUserId(run),
 *   }),
 * });
 *
 * // Start a workflow
 * const stateHandle = await myWorkflow.start(client, { email: "user@example.com" });
 *
 * // Wait for completion
 * const result = await stateHandle.wait(
 *   { type: "status", status: "completed" },
 *   { maxDurationMs: 60_000 }
 * );
 *
 * // Cleanup
 * await client.close();
 * ```
 */
export function client<AppContext = null>(params: ClientParams<AppContext>): Promise<Client<AppContext>> {
	return Promise.resolve(new ClientImpl(params));
}

class ClientImpl<AppContext> implements Client<AppContext> {
	public readonly api: ApiClient;
	public readonly _internal: Client<AppContext>["_internal"];
	public readonly logger: Logger;
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
					resolveSubscriberStrategy(this, strategy, workflowNames, workerShards),
			},
			redis: {
				getConnection: () => this.getRedisConnection(),
				closeConnection: () => this.closeRedisConnection(),
			},
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
				throw new Error("Redis configuration not provided to client. Add 'redis' to ClientParams.");
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
