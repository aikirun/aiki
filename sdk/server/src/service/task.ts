import { NotFoundError } from "@aikirun/lib/error";
import type { TaskRecord, TaskState } from "@aikirun/types/workflow/task";

import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

export interface TaskServiceDeps {
	repos: Pick<Repositories, "task">;
}

export const createTaskService = ({ repos }: TaskServiceDeps) => ({
	async getTaskById(context: NamespaceRequestContext, taskId: string): Promise<TaskRecord> {
		const task = await repos.task.getByIdWithState(context.namespaceId, taskId);
		if (!task) {
			throw new NotFoundError(`Task not found: ${taskId}`);
		}

		return {
			id: task.id,
			name: task.name,
			workflowRunId: task.workflowRunId,
			input: task.input,
			inputHash: task.inputHash,
			options: task.options !== null ? task.options : undefined,
			state: task.state as TaskState,
		};
	},
});

export type TaskService = ReturnType<typeof createTaskService>;
