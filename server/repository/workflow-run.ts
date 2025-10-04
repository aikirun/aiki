import type {
	WorkflowRunId,
	WorkflowRunParams,
	WorkflowRunResult,
	WorkflowRunRow,
	WorkflowRunState,
} from "@aiki/types/workflow";
import type { TaskRunResult } from "@aiki/types/task";

export function initWorkflowRunRepository(): Promise<WorkflowRunRepository> {
	return Promise.resolve(new WorkflowRunRepositoryImpl());
}

export interface WorkflowRunRepository {
	create: <Payload, Result>(
		name: string,
		versionId: string,
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

	updateState: (id: string, state: WorkflowRunState) => Promise<void>;
}

class WorkflowRunRepositoryImpl implements WorkflowRunRepository {
	constructor() {}

	public create<Payload, Result>(
		name: string,
		versionId: string,
		params: WorkflowRunParams<Payload>,
	): Promise<WorkflowRunRow<Payload, Result>> {
		// TODO: submit workflow and payload to storage
		// don't run the actual code yet
		// check idempotency key if provided
		return Promise.resolve({
			id: crypto.randomUUID() as WorkflowRunId,
			name,
			versionId,
			params,
			result: {
				state: "queued",
			},
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
