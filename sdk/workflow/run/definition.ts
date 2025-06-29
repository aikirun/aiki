import type { WorkflowRunParams } from "./context.ts";
import type { WorkflowRunRepository, WorkflowRunRow } from "./repository.ts";
import type { TaskRunResult } from "../../task/run/result.ts";
import type { WorkflowRunState } from "./result.ts";

export function initWorkflowRun<Payload, Result>(
	params: {
		repository: WorkflowRunRepository;
		workflowRunRow: WorkflowRunRow<Payload, Result>;
	},
): Promise<WorkflowRun<Payload, Result>> {
	return Promise.resolve(new WorkflowRunImpl(params.repository, params.workflowRunRow));
}

export interface WorkflowRun<Payload, _Result> {
	id: string;
	path: string;
	params: WorkflowRunParams<Payload>;

	updateState: (state: WorkflowRunState) => Promise<void>;

	_getSubTaskRunResult: <TaskResult>(taskPath: string) => TaskRunResult<TaskResult>;
	_addSubTaskRunResult: <TaskResult>(
		taskPath: string,
		taskResult: TaskRunResult<TaskResult>,
	) => Promise<void>;
}

class WorkflowRunImpl<Payload, Result> implements WorkflowRun<Payload, Result> {
	public readonly id: string;
	public readonly path: string;
	public readonly params: WorkflowRunParams<Payload>;

	constructor(
		private readonly repository: WorkflowRunRepository,
		private readonly workflowRunRow: WorkflowRunRow<Payload, Result>,
	) {
		this.id = workflowRunRow.id;
		this.path = `${this.workflowRunRow.workflow.path}/${workflowRunRow.id}`;
		this.params = workflowRunRow.params;
	}

	public updateState(state: WorkflowRunState): Promise<void> {
		return this.repository.updateState(this.id, state);
	}

	public _getSubTaskRunResult<TaskResult>(taskPath: string): TaskRunResult<TaskResult> {
		const taskRunResult = this.workflowRunRow.subTasksRunResult[taskPath];
		if (taskRunResult === undefined) {
			return {
				state: "none",
			};
		}

		// TODO: check that pre-existing result is instance of expected result type
		return taskRunResult as TaskRunResult<TaskResult>;
	}

	public async _addSubTaskRunResult<TaskResult>(
		taskPath: string,
		taskResult: TaskRunResult<TaskResult>,
	): Promise<void> {
		await this.repository.addSubTaskRunResult(
			this.id,
			taskPath,
			taskResult,
		);
		this.workflowRunRow.subTasksRunResult[taskPath] = taskResult;
	}
}
