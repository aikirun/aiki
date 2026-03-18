import type { ApiKeyService } from "server/service/api-key";
import type { NamespaceService } from "server/service/namespace";
import type { ScheduleService } from "server/service/schedule";
import type { WorkflowService } from "server/service/workflow";

import { createApiKeyRouter } from "./api-key";
import { namespaceAuthedImplementer, organizationAuthedImplementer, publicImplementer } from "./implementer";
import { createNamespaceRouter } from "./namespace";
import { createScheduleRouter } from "./schedule";
import { createWorkflowRouter } from "./workflow";
import { createWorkflowRunRouter, type WorkflowRunRouterDeps } from "./workflow-run";

export function createPublicRouter() {
	return publicImplementer.router({});
}

export function createOrganizationAuthedRouter(namespaceService: NamespaceService) {
	return organizationAuthedImplementer.router({
		namespace: createNamespaceRouter(namespaceService),
	});
}

export interface NamespaceAuthedRouterDeps extends WorkflowRunRouterDeps {
	apiKeyService: ApiKeyService;
	scheduleService: ScheduleService;
	workflowService: WorkflowService;
}

export function createNamespaceAuthedRouter(deps: NamespaceAuthedRouterDeps) {
	return namespaceAuthedImplementer.router({
		apiKey: createApiKeyRouter(deps.apiKeyService),
		schedule: createScheduleRouter(deps.scheduleService),
		workflow: createWorkflowRouter(deps.workflowService),
		workflowRun: createWorkflowRunRouter({
			workflowRunService: deps.workflowRunService,
			workflowRunStateMachineService: deps.workflowRunStateMachineService,
			taskStateMachineService: deps.taskStateMachineService,
			workflowRunOutboxService: deps.workflowRunOutboxService,
		}),
	});
}
