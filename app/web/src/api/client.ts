import type { ApiKeyApi } from "@aikirun/types/api/api-key";
import type { NamespaceApi } from "@aikirun/types/api/namespace";
import type { ScheduleApi } from "@aikirun/types/api/schedule";
import type { WorkflowApi } from "@aikirun/types/api/workflow";
import type { WorkflowRunApi } from "@aikirun/types/api/workflow-run";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

const AIKI_SERVER_URL = import.meta.env.VITE_AIKI_SERVER_URL || "http://localhost:9850";

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
	apiKey: ApiKeyApi;
	namespace: NamespaceApi;
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
