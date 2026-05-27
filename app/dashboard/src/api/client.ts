import type { ApiKeyContract, NamespaceContract } from "@aikirun/iam/contract";
import type { ScheduleApi } from "@aikirun/types/api/schedule";
import type { WorkflowApi } from "@aikirun/types/api/workflow";
import type { WorkflowRunApi } from "@aikirun/types/api/workflow-run";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";

import { AIKI_SERVER_URL } from "../config";

const fetchWithCredentials = (url: RequestInfo | URL, options?: RequestInit) =>
	fetch(url, { ...options, credentials: "include" });

const namespaceAuthedLink = new RPCLink({
	url: `${AIKI_SERVER_URL}/api`,
	fetch: fetchWithCredentials,
});

const organizationAuthedLink = new RPCLink({
	url: `${AIKI_SERVER_URL}/dashboard`,
	fetch: fetchWithCredentials,
});

export const namespaceAuthedClient = createORPCClient(namespaceAuthedLink) as unknown as {
	schedule: ScheduleApi;
	workflow: WorkflowApi;
	workflowRun: WorkflowRunApi;
};

export const organizationAuthedClient = createORPCClient(organizationAuthedLink) as unknown as {
	apiKey: ContractRouterClient<ApiKeyContract>;
	namespace: ContractRouterClient<NamespaceContract>;
};

export const namespaceManagementClient = organizationAuthedClient.namespace;

export async function createNamespace(name: string) {
	const data = await namespaceManagementClient.createV1({ name });
	return {
		namespace: {
			...data.namespace,
			createdAt: new Date(data.namespace.createdAt),
		},
	};
}
