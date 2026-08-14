import { namespaceAuthedImplementer } from "./implementer";
import type { TaskStateMachine } from "../service/state-machine/task-state-machine";
import type { TaskService } from "../service/task";

export interface TaskRouterDeps {
	taskService: TaskService;
	taskStateMachine: TaskStateMachine;
}

export function createTaskRouter(deps: TaskRouterDeps) {
	const os = namespaceAuthedImplementer.task;
	const { taskService, taskStateMachine } = deps;

	return os.router({
		getByIdV1: os.getByIdV1.handler(async ({ input: request, context }) => {
			const task = await taskService.getTaskById(context, request.id);
			return { task };
		}),

		transitionStateV1: os.transitionStateV1.handler(async ({ input: request, context }) => {
			const taskInfo = await taskStateMachine.transitionState(context, request);
			return { taskInfo };
		}),

		setStateV1: os.setStateV1.handler(async ({ input: request, context }) => {
			await taskService.setTaskState(context, request);
		}),
	});
}
