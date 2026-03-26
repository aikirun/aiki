import process from "node:process";
import type { ApiClient, Client, ClientParams, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { ConsoleLogger } from "./logger/index";

/**
 * Creates an Aiki client for starting and managing workflows.
 *
 * The client connects to the Aiki server via HTTP.
 * It provides methods to start workflows and monitor their execution.
 *
 * @template AppContext - Type of application context passed to workflows (default: null)
 * @param params - Client configuration parameters
 * @param params.url - HTTP URL of the Aiki server (e.g., "http://localhost:9850")
 * @param params.apiKey - API key for authentication. Falls back to AIKI_API_KEY env variable if not provided.
 * @param params.createContext - Optional function to create context for each workflow run
 * @param params.logger - Optional custom logger (defaults to ConsoleLogger)
 * @returns Promise resolving to a configured Client instance
 *
 * @example
 * ```typescript
 * const aikiClient = client({
 *   url: "http://localhost:9850",
 *   apiKey: "yourApiKey", // or omit to use AIKI_API_KEY env variable
 *   createContext: (run) => ({
 *     traceId: generateTraceId(),
 *     userId: extractUserId(run),
 *   }),
 * });
 *
 * // Start a workflow
 * const handle = await myWorkflow.start(aikiClient, { email: "user@example.com" });
 *
 * // Wait for completion
 * const result = await handle.wait(
 *   { type: "status", status: "completed" },
 *   { maxDurationMs: 60_000 }
 * );
 * ```
 */
export function client<AppContext = null>(params: ClientParams<AppContext>): Client<AppContext> {
	return new ClientImpl(params);
}

class ClientImpl<AppContext> implements Client<AppContext> {
	public readonly api: ApiClient;
	public readonly [INTERNAL]: Client<AppContext>[typeof INTERNAL];
	public readonly logger: Logger;

	constructor(private readonly params: ClientParams<AppContext>) {
		this.logger = params.logger ?? new ConsoleLogger();

		const apiKey = params.apiKey ?? process.env.AIKI_API_KEY;
		if (!apiKey) {
			throw new Error(`API key is required. Provide it via 'apiKey' param or AIKI_API_KEY env variable`);
		}

		const rpcLink = new RPCLink({
			url: `${params.url}/api`,
			headers: () => ({
				Authorization: `Bearer ${apiKey}`,
			}),
		});
		// Type safety: The server package has compile-time tests (see server/contract/workflow-run/procedure.ts)
		// that verify the contract matches WorkflowRunApi. If the contract changes, server won't compile.
		this.api = createORPCClient(rpcLink) as unknown as ApiClient;

		this.logger.info("Aiki client initialized", {
			"aiki.url": params.url,
		});

		this[INTERNAL] = {
			createContext: this.params.createContext,
		};
	}
}
