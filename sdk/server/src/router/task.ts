import { namespaceAuthedImplementer } from "./implementer";
import type { TaskService } from "../service/task";
import type { TaskStateMachineService } from "../service/task-state-machine";

export interface TaskRouterDeps {
	taskService: TaskService;
	taskStateMachineService: TaskStateMachineService;
}

export function createTaskRouter(deps: TaskRouterDeps) {
	const os = namespaceAuthedImplementer.task;
	const { taskService, taskStateMachineService } = deps;

	return os.router({
		getByIdV1: os.getByIdV1.handler(async ({ input: request, context }) => {
			const task = await taskService.getTaskById(context, request.id);
			return { task };
		}),

		transitionStateV1: os.transitionStateV1.handler(async ({ input: request, context }) => {
			const taskInfo = await taskStateMachineService.transitionState(context, request);
			return { taskInfo };
		}),

		setStateV1: os.setStateV1.handler(async ({ input: request, context }) => {
			await taskService.setTaskState(context, request);
		}),
	});
}
