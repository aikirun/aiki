import { createApiKeyRouter } from "./api-key";
import { namespaceAuthedImplementer, organizationAuthedImplementer, publicImplementer } from "./implementer";
import { createNamespaceRouter } from "./namespace";
import { createScheduleRouter } from "./schedule";
import { createWorkflowRouter } from "./workflow";
import { createWorkflowRunRouter, type WorkflowRunRouterDeps } from "./workflow-run";
import type { ApiKeyService } from "../service/api-key";
import type { NamespaceService } from "../service/namespace";
import type { ScheduleService } from "../service/schedule";
import type { WorkflowService } from "../service/workflow";

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
