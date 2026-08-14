import { namespaceAuthedImplementer, publicImplementer } from "./implementer";
import { createScheduleRouter } from "./schedule";
import { createTaskRouter } from "./task";
import { createWorkflowRouter } from "./workflow";
import { createWorkflowRunRouter, type WorkflowRunRouterDeps } from "./workflow-run";
import type { ScheduleService } from "../service/schedule";
import type { TaskService } from "../service/task";
import type { WorkflowService } from "../service/workflow";

export function createPublicRouter() {
	return publicImplementer.router({});
}

export interface NamespaceAuthedRouterDeps extends WorkflowRunRouterDeps {
	scheduleService: ScheduleService;
	taskService: TaskService;
	workflowService: WorkflowService;
}

export function createNamespaceAuthedRouter(deps: NamespaceAuthedRouterDeps) {
	return namespaceAuthedImplementer.router({
		schedule: createScheduleRouter(deps.scheduleService),
		task: createTaskRouter({ taskService: deps.taskService }),
		workflow: createWorkflowRouter(deps.workflowService),
		workflowRun: createWorkflowRunRouter({
			workflowRunService: deps.workflowRunService,
			workflowRunStateMachineService: deps.workflowRunStateMachineService,
			taskStateMachineService: deps.taskStateMachineService,
			workflowRunOutboxService: deps.workflowRunOutboxService,
		}),
	});
}
