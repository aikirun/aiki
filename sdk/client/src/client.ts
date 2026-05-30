import type { Logger } from "@aikirun/lib/logger";
import { ConsoleLogger } from "@aikirun/lib/logger";
import type { ApiClient, Client, ClientParams, EmbeddedClientParams, RemoteClientParams } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

const EMBEDDED_BASE_URL = "aiki://embedded/api";

/**
 * Creates an Aiki client.
 *
 * Two transports are supported:
 * - Remote: connects to the Aiki server over HTTP.
 * - Embedded: invokes the server's handler directly in-process — no network hop.
 *
 * Switching transports is a config-only change; workers and workflows are unaffected.
 *
 * @example
 * ```typescript
 * // Remote
 * const aikiClient = client({
 *   url: "http://localhost:9850",
 *   apiKey: "yourApiKey",
 * });
 *
 * // Embedded — server and client in the same process
 * const aiki = server({ db: { connectionString: "postgres://..." } });
 * const aikiClient = client({ handler: aiki.handler });
 *
 * const handle = await myWorkflow.start(aikiClient, { email: "user@example.com" });
 * const result = await handle.wait(
 *   { type: "status", status: "completed" },
 *   { maxDurationMs: 60_000 }
 * );
 * ```
 */
export function client<Context = null>(params: RemoteClientParams<Context>): Client<Context>;
export function client<Context = null>(params: EmbeddedClientParams<Context>): Client<Context>;
export function client<Context = null>(params: ClientParams<Context>): Client<Context> {
	return new ClientImpl(params);
}

class ClientImpl<Context> implements Client<Context> {
	public readonly api: ApiClient;
	public readonly [INTERNAL]: Client<Context>[typeof INTERNAL];
	public readonly logger: Logger;

	constructor(params: ClientParams<Context>) {
		this.logger = params.logger ?? new ConsoleLogger();

		const rpcLink = isEmbeddedParams(params)
			? new RPCLink({
					url: EMBEDDED_BASE_URL,
					fetch: (request) => params.handler(request),
				})
			: new RPCLink({
					url: `${params.url}/api`,
					headers: () => (params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
				});

		// Type safety: The server package has compile-time tests (see server/contract/workflow-run/procedure.ts)
		// that ensures the contract matches WorkflowRunApi. If the contract changes, server won't compile.
		this.api = createORPCClient(rpcLink) as unknown as ApiClient;

		if (isEmbeddedParams(params)) {
			this.logger.info("Aiki client initialized", { "aiki.transport": "embedded" });
		} else {
			this.logger.info("Aiki client initialized", {
				"aiki.transport": "remote",
				"aiki.url": params.url,
			});
		}

		this[INTERNAL] = {
			context: params.context,
		};
	}
}

function isEmbeddedParams<Context>(params: ClientParams<Context>): params is EmbeddedClientParams<Context> {
	return "handler" in params;
}
