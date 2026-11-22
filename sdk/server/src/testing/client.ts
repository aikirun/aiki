import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";

import type { NamespaceAuthedContract } from "../contract/namespace-authed";

export function createNamespaceAuthedClient(handler: (request: Request) => Promise<Response>) {
	return createORPCClient<ContractRouterClient<NamespaceAuthedContract>>(
		new RPCLink({ url: "http://localhost/api", fetch: (request) => handler(request) })
	);
}
