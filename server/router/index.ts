import type { ApiKeyService } from "server/service/api-key";
import type { NamespaceService } from "server/service/namespace";

import { createApiKeyRouter } from "./api-key";
import { namespaceAuthedImplementer, organizationAuthedImplementer, publicImplementer } from "./implementer";
import { createNamespaceRouter } from "./namespace";
import { scheduleRouter } from "./schedule";
import { workflowRouter } from "./workflow";
import { workflowRunRouter } from "./workflow-run";

export function createPublicRouter() {
	return publicImplementer.router({});
}

export function createOrganizationAuthedRouter(namespaceService: NamespaceService) {
	return organizationAuthedImplementer.router({
		namespace: createNamespaceRouter(namespaceService),
	});
}

export function createNamespaceAuthedRouter(apiKeyService: ApiKeyService) {
	return namespaceAuthedImplementer.router({
		apiKey: createApiKeyRouter(apiKeyService),
		schedule: scheduleRouter,
		workflow: workflowRouter,
		workflowRun: workflowRunRouter,
	});
}
