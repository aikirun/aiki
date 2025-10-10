import type { WorkflowRunRow, WorkflowRunState } from "@aiki/contract/workflow-run";
import type { Client } from "../../client/client.ts";
import type { TaskRunResult } from "@aiki/contract/task-run";

export function initWorkflowRunHandle<Input, Output>(
	api: Client["api"],
	run: WorkflowRunRow<Input, Output>,
): WorkflowRunHandle<Input, Output> {
	return new WorkflowRunHandleImpl(api, run);
}

export interface WorkflowRunHandle<Input, Output> {
	run: WorkflowRunRow<Input, Output>;

	updateState: (state: WorkflowRunState) => Promise<void>;

	_internal: {
		getSubTaskRunResult: <TaskOutput>(taskPath: string) => TaskRunResult<TaskOutput>;
		addSubTaskRunResult: <TaskOutput>(taskPath: string, taskRunResult: TaskRunResult<TaskOutput>) => Promise<void>;
	};
}

class WorkflowRunHandleImpl<Input, Output> implements WorkflowRunHandle<Input, Output> {
	public readonly _internal: WorkflowRunHandle<Input, Output>["_internal"];

	constructor(
		private readonly api: Client["api"],
		public readonly run: WorkflowRunRow<Input, Output>,
	) {
		this._internal = {
			getSubTaskRunResult: this.getSubTaskRunResult.bind(this),
			addSubTaskRunResult: this.addSubTaskRunResult.bind(this),
		};
	}

	public async updateState(state: WorkflowRunState): Promise<void> {
		await this.api.workflowRun.updateStateV1({ id: this.run.id, state });
	}

	private getSubTaskRunResult<TaskOutput>(taskPath: string): TaskRunResult<TaskOutput> {
		const taskRunResult = this.run.subTasksRunResult[taskPath];
		if (taskRunResult === undefined) {
			return {
				state: "none",
			};
		}

		// TODO: check that pre-existing result is instance of expected result type
		return taskRunResult as TaskRunResult<TaskOutput>;
	}

	private async addSubTaskRunResult<TaskOutput>(
		taskPath: string,
		taskRunResult: TaskRunResult<TaskOutput>,
	): Promise<void> {
		await this.api.workflowRun.addSubTaskRunResultV1({
			id: this.run.id,
			taskPath,
			taskRunResult,
		});
		this.run.subTasksRunResult[taskPath] = taskRunResult;
	}
}
