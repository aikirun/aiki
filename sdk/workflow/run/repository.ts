import type { BrandedString } from "@lib/string/types.ts";
import type { TaskRunResult } from "../../task/run/result.ts";
import type { WorkflowName, WorkflowVersion, WorkflowVersionId } from "../workflow.ts";
import type { WorkflowRunParams } from "./context.ts";
import type { WorkflowRunResult, WorkflowRunState } from "./result.ts";

export function initWorkflowRunRepository(): Promise<WorkflowRunRepository> {
	return Promise.resolve(new WorkflowRunRepositoryImpl());
}

export interface WorkflowRunRepository {
	create: <Payload, Result>(
		workflowVersion: WorkflowVersion<Payload, Result>,
		workflowRunParams: WorkflowRunParams<Payload>,
	) => Promise<WorkflowRunRow<Payload, Result>>;

	getById: (id: WorkflowRunId) => Promise<WorkflowRunRow<unknown, unknown> | undefined>;

	getResult: <Result>(id: string) => Promise<WorkflowRunResult<Result>>;

	getReadyIds: (size: number) => Promise<WorkflowRunId[]>;

	addSubTaskRunResult: <TaskResult>(
		workflowRunId: string,
		taskPath: string,
		taskResult: TaskRunResult<TaskResult>,
	) => Promise<void>;

	updateHeartbeat: (id: string) => Promise<void>;

	updateState: (id: string, state: WorkflowRunState) => Promise<void>;
}

export type WorkflowRunId = BrandedString<"workflow_run_id">;

export interface WorkflowRunRow<Payload, Result> {
	id: WorkflowRunId;
	params: WorkflowRunParams<Payload>;
	result: WorkflowRunResult<Result>;
	workflowVersion: {
		name: WorkflowName;
		versionId: WorkflowVersionId;
	};
	subTasksRunResult: Record<string, TaskRunResult<unknown>>;
	subWorkflowsRunResult: Record<string, WorkflowRunResult<unknown>>;
}

class WorkflowRunRepositoryImpl implements WorkflowRunRepository {
	constructor() {}

	public create<Payload, Result>(
		workflowVersion: WorkflowVersion<Payload, Result>,
		params: WorkflowRunParams<Payload>,
	): Promise<WorkflowRunRow<Payload, Result>> {
		// TODO: submit workflow and payload to storage
		// don't run the actual code yet
		// check idempotency key if provided
		return Promise.resolve({
			id: crypto.randomUUID() as WorkflowRunId,
			params,
			result: {
				state: "queued",
			},
			workflowVersion,
			subTasksRunResult: {},
			subWorkflowsRunResult: {},
		});
	}

	public getResult<Result>(_id: string): Promise<WorkflowRunResult<Result>> {
		// TODO: get result from storage
		return Promise.resolve({
			state: "queued",
		});
	}

	public addSubTaskRunResult<TaskResult>(
		_workflowRunId: string,
		_taskPath: string,
		_taskResult: TaskRunResult<TaskResult>,
	): Promise<void> {
		// TODO: add in storage
		return Promise.resolve();
	}

	public updateHeartbeat(_workflowRunId: string): Promise<void> {
		return Promise.resolve();
	}

	public updateState(_id: string, _state: WorkflowRunState): Promise<void> {
		return Promise.resolve();
	}

	public getById(id: WorkflowRunId): Promise<WorkflowRunRow<unknown, unknown> | undefined> {
		// TODO: fetch workflow run by ID from persistent storage
		// This would query the database for a specific workflow run by its ID
		// For now, return undefined since this is a mock implementation
		// deno-lint-ignore no-console
		console.log(`Mock: getById called with ID ${id}`);
		return Promise.resolve(undefined);
	}

	public getReadyIds(_size: number): Promise<WorkflowRunId[]> {
		// TODO: fetch queued workflow runs from persistent storage
		// This would query the database for workflow runs with state "queued"
		return Promise.resolve([]);
	}
}
