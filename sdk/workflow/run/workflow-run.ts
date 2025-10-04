import type { WorkflowRunId, WorkflowRunParams, WorkflowRunRow, WorkflowRunState } from "@aiki/types/workflow";
import type { Client } from "../../client/client.ts";
import type { TaskRunResult } from "@aiki/types/task";

export function initWorkflowRun<Payload, Result>(
	api: Client["api"],
	workflowRunRow: WorkflowRunRow<Payload, Result>,
): Promise<WorkflowRun<Payload, Result>> {
	return Promise.resolve(new WorkflowRunImpl(api, workflowRunRow));
}

export interface WorkflowRun<Payload, _Result> {
	id: WorkflowRunId;
	path: string;
	params: WorkflowRunParams<Payload>;

	updateState: (state: WorkflowRunState) => Promise<void>;

	_internal: {
		getSubTaskRunResult: <TaskResult>(taskPath: string) => TaskRunResult<TaskResult>;
		addSubTaskRunResult: <TaskResult>(
			taskPath: string,
			taskResult: TaskRunResult<TaskResult>,
		) => Promise<void>;
	};
}

class WorkflowRunImpl<Payload, Result> implements WorkflowRun<Payload, Result> {
	public readonly id: WorkflowRunId;
	public readonly path: string;
	public readonly params: WorkflowRunParams<Payload>;
	public readonly _internal: WorkflowRun<Payload, Result>["_internal"];

	constructor(
		private readonly api: Client["api"],
		private readonly workflowRunRow: WorkflowRunRow<Payload, Result>,
	) {
		this.id = workflowRunRow.id;
		this.path = `${workflowRunRow.name}/${workflowRunRow.versionId}/${this.id}`;
		this.params = workflowRunRow.params;

		this._internal = {
			getSubTaskRunResult: this.getSubTaskRunResult,
			addSubTaskRunResult: this.addSubTaskRunResult,
		};
	}

	public updateState(state: WorkflowRunState): Promise<void> {
		return this.api.workflowRun.updateStateV1.mutate({ id: this.id, state });
	}

	private getSubTaskRunResult<TaskResult>(taskPath: string): TaskRunResult<TaskResult> {
		const taskRunResult = this.workflowRunRow.subTasksRunResult[taskPath];
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
		taskResult: TaskRunResult<TaskResult>,
	): Promise<void> {
		await this.api.workflowRun.addSubTaskRunResultV1.mutate({
			workflowRunId: this.id,
			taskPath,
			taskResult,
		});
		this.workflowRunRow.subTasksRunResult[taskPath] = taskResult;
	}
}
