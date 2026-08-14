import { namespaceAuthedImplementer, publicImplementer } from "./implementer";
import { createScheduleRouter } from "./schedule";
import { createTaskRouter } from "./task";
import { createWorkflowRouter } from "./workflow";
import { createWorkflowRunRouter, type WorkflowRunRouterDeps } from "./workflow-run";
import type { ScheduleService } from "../service/schedule";
import type { TaskService } from "../service/task";
import type { TaskStateMachineService } from "../service/task-state-machine";
import type { WorkflowService } from "../service/workflow";

export function createPublicRouter() {
	return publicImplementer.router({});
}

export interface NamespaceAuthedRouterDeps extends WorkflowRunRouterDeps {
	scheduleService: ScheduleService;
	taskService: TaskService;
	taskStateMachineService: TaskStateMachineService;
	workflowService: WorkflowService;
}

export function createNamespaceAuthedRouter(deps: NamespaceAuthedRouterDeps) {
	return namespaceAuthedImplementer.router({
		schedule: createScheduleRouter(deps.scheduleService),
		task: createTaskRouter({
			taskService: deps.taskService,
			taskStateMachineService: deps.taskStateMachineService,
		}),
		workflow: createWorkflowRouter(deps.workflowService),
		workflowRun: createWorkflowRunRouter({
			workflowRunService: deps.workflowRunService,
			workflowRunStateMachineService: deps.workflowRunStateMachineService,
			workflowRunOutboxService: deps.workflowRunOutboxService,
		}),
	});
}
