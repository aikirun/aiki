import { withRetry } from "@lib/retry/mod.ts";
import type { WorkflowRunParams } from "./context.ts";
import type { WorkflowRunRepository, WorkflowRunRow } from "./repository.ts";
import type { TaskRunResult } from "../../task/run/result.ts";
import type {
	WorkflowRunResult,
	WorkflowRunResultComplete,
	WorkflowRunResultInComplete,
	WorkflowRunState,
} from "./result.ts";

export function initWorkflowRun<Payload, Result>(
	params: {
		repository: WorkflowRunRepository;
		workflowRunRow: WorkflowRunRow<Payload, Result>;
	},
): Promise<WorkflowRun<Payload, Result>> {
	return Promise.resolve(
		new WorkflowRunImpl(params.repository, params.workflowRunRow),
	);
}

export interface WorkflowRun<Payload, Result> {
	id: string;
	path: string;
	params: WorkflowRunParams<Payload>;

	getResult: () => Promise<WorkflowRunResult<Result>>;

	waitForStateSync<
		T extends WorkflowRunState,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U>;

	_getSubTaskRunResult: <TaskResult>(
		taskPath: string,
	) => TaskRunResult<TaskResult>;
	_addSubTaskRunResult: <TaskResult>(
		taskPath: string,
		taskResult: TaskRunResult<TaskResult>,
	) => Promise<void>;
}

export interface WorkflowRunWaitSyncParams {
	maxDurationMs: number;
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

	public getResult(): Promise<WorkflowRunResult<Result>> {
		return this.repository.getResult(this.id);
	}

	// TODO only use in tests
	public async waitForStateSync<
		T extends WorkflowRunState,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U> {
		// TODO choose proper default
		const delayMs = 100;

		const result = await withRetry(
			this.getResult,
			{
				type: "fixed",
				maxAttempts: Math.ceil(params.maxDurationMs / delayMs),
				delayMs,
			},
			(result) => Promise.resolve(result.state !== state),
		).run();

		return result as U;
	}

	public _getSubTaskRunResult<TaskResult>(
		taskPath: string,
	): TaskRunResult<TaskResult> {
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
