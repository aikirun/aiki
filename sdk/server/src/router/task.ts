import { namespaceAuthedImplementer } from "./implementer";
import type { TaskService } from "../service/task";

export interface TaskRouterDeps {
	taskService: TaskService;
}

export function createTaskRouter(deps: TaskRouterDeps) {
	const os = namespaceAuthedImplementer.task;
	const { taskService } = deps;

	return os.router({
		getByIdV1: os.getByIdV1.handler(async ({ input: request, context }) => {
			const task = await taskService.getTaskById(context, request.id);
			return { task };
		}),
	});
}
