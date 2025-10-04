import type { WorkflowRunParams } from "./context.ts";
import type { WorkflowRunId, WorkflowRunRepository, WorkflowRunRow } from "./repository.ts";
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
	public readonly _internal: WorkflowRun<Payload, Result>["_internal"]

	constructor(
		private readonly repository: WorkflowRunRepository,
		private readonly workflowRunRow: WorkflowRunRow<Payload, Result>,
	) {
		this.id = workflowRunRow.id;
		const { name, versionId } = workflowRunRow.workflowVersion;
		this.path = `${name}/${versionId}/${this.id}`;
		this.params = workflowRunRow.params;

		this._internal = {
			getSubTaskRunResult: this.getSubTaskRunResult,
			addSubTaskRunResult: this.addSubTaskRunResult
		};
	}

	public updateState(state: WorkflowRunState): Promise<void> {
		return this.repository.updateState(this.id, state);
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
		await this.repository.addSubTaskRunResult(
			this.id,
			taskPath,
			taskResult,
		);
		this.workflowRunRow.subTasksRunResult[taskPath] = taskResult;
	}
}
