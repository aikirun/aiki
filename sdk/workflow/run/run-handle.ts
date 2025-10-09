import type { WorkflowRunRow, WorkflowRunState } from "@aiki/contract/workflow-run";
import type { Client } from "../../client/client.ts";
import type { TaskRunResult } from "@aiki/contract/task-run";

export function initWorkflowRunHandle<Payload, Result>(
	api: Client["api"],
	run: WorkflowRunRow<Payload, Result>,
): WorkflowRunHandle<Payload, Result> {
	return new WorkflowRunHandleImpl(api, run);
}

export interface WorkflowRunHandle<Payload, Result> {
	run: WorkflowRunRow<Payload, Result>;

	updateState: (state: WorkflowRunState) => Promise<void>;

	_internal: {
		getSubTaskRunResult: <TaskResult>(taskPath: string) => TaskRunResult<TaskResult>;
		addSubTaskRunResult: <TaskResult>(taskPath: string, taskRunResult: TaskRunResult<TaskResult>) => Promise<void>;
	};
}

class WorkflowRunHandleImpl<Payload, Result> implements WorkflowRunHandle<Payload, Result> {
	public readonly _internal: WorkflowRunHandle<Payload, Result>["_internal"];

	constructor(
		private readonly api: Client["api"],
		public readonly run: WorkflowRunRow<Payload, Result>,
	) {
		this._internal = {
			getSubTaskRunResult: this.getSubTaskRunResult,
			addSubTaskRunResult: this.addSubTaskRunResult,
		};
	}

	public async updateState(state: WorkflowRunState): Promise<void> {
		await this.api.workflowRun.updateStateV1({ id: this.run.id, state });
	}

	private getSubTaskRunResult<TaskResult>(taskPath: string): TaskRunResult<TaskResult> {
		const taskRunResult = this.run.subTasksRunResult[taskPath];
		if (taskRunResult === undefined) {
			return {
				state: "none",
			};
		}

		// TODO: check that pre-existing result is instance of expected result type
		return taskRunResult as TaskRunResult<TaskResult>;
	}

	private async addSubTaskRunResult<TaskResult>(
		taskPath: string,
		taskRunResult: TaskRunResult<TaskResult>,
	): Promise<void> {
		await this.api.workflowRun.addSubTaskRunResultV1({
			id: this.run.id,
			taskPath,
			taskRunResult,
		});
		this.run.subTasksRunResult[taskPath] = taskRunResult;
	}
}
