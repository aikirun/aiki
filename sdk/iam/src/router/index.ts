import { createApiKeyRouter } from "./api-key";
import { organizationAuthedRouterImplementer } from "./implementer";
import { createNamespaceRouter } from "./namespace";
import type { ApiKeyService } from "../service/api-key";
import type { NamespaceService } from "../service/namespace";

export interface OrganizationAuthedRouterDeps {
	apiKeyService: ApiKeyService;
	namespaceService: NamespaceService;
}

export function createOrganizationAuthedRouter(deps: OrganizationAuthedRouterDeps) {
	return organizationAuthedRouterImplementer.router({
		apiKey: createApiKeyRouter(deps.apiKeyService, deps.namespaceService),
		namespace: createNamespaceRouter(deps.namespaceService),
	});
}
