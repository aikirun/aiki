import { AikiClient } from "../client/index.ts";
import { TaskRunResult } from "../task/index.ts";
import { Workflow, WorkflowRunParams } from "../workflow/index.ts";
import { WorkflowRun, WorkflowRunResult, WorkflowRunRow } from "./type.ts";

export class WorkflowRunImpl<Payload, Result> implements WorkflowRun<Payload, Result> {
	public readonly id: string;
	public readonly path: string;

	constructor(
		private readonly client: AikiClient,
		private readonly workflow: Workflow<Payload, Result>, 
		public readonly params: WorkflowRunParams<Payload>,
		private readonly workflowRunRow: WorkflowRunRow,
	) {
		this.id = workflowRunRow.id;
		this.path = `${workflow.path}/${workflowRunRow.id}`;
	}

	public getResult(): Promise<WorkflowRunResult<Result>> {
		return this.client.workflowRunRepository.getResult(this.id);
	}

	public _getSubTaskRunResult<TaskResult>(taskPath: string): TaskRunResult<TaskResult> {
		const taskRunResult = this.workflowRunRow.subTasksRunResult[taskPath];
		if (taskRunResult === undefined) {
			return {
				state: "none"
			};
		}

		// TODO: check that pre-existing result is instance of expected result type
		return taskRunResult as TaskRunResult<TaskResult>;
	}

	public async _addSubTaskRunResult<TaskResult>(taskPath: string, taskResult: TaskRunResult<TaskResult>): Promise<void> {
		await this.client.workflowRunRepository.addSubTaskRunResult(this.id, taskPath, taskResult);
		this.workflowRunRow.subTasksRunResult[taskPath] = taskResult;
	}
}
