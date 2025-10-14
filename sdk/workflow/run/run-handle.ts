import type { WorkflowRun, WorkflowRunState } from "@aiki/types/workflow-run";
import type { ApiClient } from "@aiki/types/client";
import type { TaskState } from "@aiki/types/task";

export function initWorkflowRunHandle<Input, Output>(
	api: ApiClient,
	run: WorkflowRun<Input, Output>,
): WorkflowRunHandle<Input, Output> {
	return new WorkflowRunHandleImpl(api, run);
}

export interface WorkflowRunHandle<Input, Output> {
	run: WorkflowRun<Input, Output>;

	updateState: (state: WorkflowRunState) => Promise<void>;

	_internal: {
		getTaskState: (taskPath: string) => TaskState<unknown>;
		transitionTaskState: (taskPath: string, taskState: TaskState<unknown>) => Promise<void>;
	};
}

class WorkflowRunHandleImpl<Input, Output> implements WorkflowRunHandle<Input, Output> {
	public readonly _internal: WorkflowRunHandle<Input, Output>["_internal"];

	constructor(
		private readonly api: ApiClient,
		public readonly run: WorkflowRun<Input, Output>,
	) {
		this._internal = {
			getTaskState: this.getTaskState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
		};
	}

	public async updateState(state: WorkflowRunState): Promise<void> {
		await this.api.workflowRun.updateStateV1({ id: this.run.id, state });
	}

	private getTaskState(taskPath: string): TaskState<unknown> {
		return this.run.tasksState[taskPath] ?? {
			state: "none",
		};
	}

	private async transitionTaskState(taskPath: string, taskState: TaskState<unknown>): Promise<void> {
		await this.api.workflowRun.transitionTaskStateV1({
			id: this.run.id,
			taskPath,
			taskState: taskState,
		});
		this.run.tasksState[taskPath] = taskState;
	}
}
