import type { WorkflowRun, WorkflowRunState } from "@aiki/types/workflow-run";
import type { ApiClient } from "@aiki/types/client";
import type { TaskRunResult } from "@aiki/types/task-run";

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
		getSubTaskRunResult: (taskPath: string) => TaskRunResult<unknown>;
		addSubTaskRunResult: (taskPath: string, taskRunResult: TaskRunResult<unknown>) => Promise<void>;
	};
}

class WorkflowRunHandleImpl<Input, Output> implements WorkflowRunHandle<Input, Output> {
	public readonly _internal: WorkflowRunHandle<Input, Output>["_internal"];

	constructor(
		private readonly api: ApiClient,
		public readonly run: WorkflowRun<Input, Output>,
	) {
		this._internal = {
			getSubTaskRunResult: this.getSubTaskRunResult.bind(this),
			addSubTaskRunResult: this.addSubTaskRunResult.bind(this),
		};
	}

	public async updateState(state: WorkflowRunState): Promise<void> {
		await this.api.workflowRun.updateStateV1({ id: this.run.id, state });
	}

	private getSubTaskRunResult(taskPath: string): TaskRunResult<unknown> {
		return this.run.subTasksRunResult[taskPath] ?? {
			state: "none",
		};
	}

	private async addSubTaskRunResult(
		taskPath: string,
		taskRunResult: TaskRunResult<unknown>,
	): Promise<void> {
		// todo: one task can have multiple results
		await this.api.workflowRun.addSubTaskRunResultV1({
			id: this.run.id,
			taskPath,
			taskRunResult,
		});
		this.run.subTasksRunResult[taskPath] = taskRunResult;
	}
}
