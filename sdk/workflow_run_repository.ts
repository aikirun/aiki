import type { TaskRunResult } from "./task_run.ts";
import type { Workflow, WorkflowRunParams } from "./workflow.ts";
import type { WorkflowRunResult } from "./workflow_run.ts";

export function intiWorkflowRunRepository(): Promise<WorkflowRunRepository> {
    return Promise.resolve(new WorkflowRunRepositoryImpl());
}

export interface WorkflowRunRepository {
    create: <Payload, Result>(
        workflow: Workflow<Payload, Result>, 
        workflowRunParams: WorkflowRunParams<Payload>
    ) => Promise<WorkflowRunRow<Payload, Result>>;

    getResult: <Result>(id: string) => Promise<WorkflowRunResult<Result>>;

    addSubTaskRunResult: <TaskResult>(
        workflowRunId: string, 
        taskPath: string, 
        taskResult: TaskRunResult<TaskResult>
    ) => Promise<void>;

	getNextToExecute: () => Promise<WorkflowRunRow<unknown, unknown> | null>;
}

export interface WorkflowRunRow<Payload, Result> {
    id: string;
	params: WorkflowRunParams<Payload>;
	result: WorkflowRunResult<Result>;
	workflow: Pick<Workflow<Payload, Result>, "path">;
    subTasksRunResult: Record<string, TaskRunResult<unknown>>,
    subWorkflowsRunResult: Record<string, WorkflowRunResult<unknown>>,
}

export class WorkflowRunRepositoryImpl implements WorkflowRunRepository {
    constructor() {}

    public create<Payload, Result>(
        workflow: Workflow<Payload, Result>, 
        params: WorkflowRunParams<Payload>
    ): Promise<WorkflowRunRow<Payload, Result>> {
        // TODO: submit workflow and payload to storage
		// don't run the actual code yet
		// check idempotency key if provided
        return Promise.resolve({
            id: "1",
            params,
            result: {
                state: "queued"
            },
            workflow: {
                path: workflow.path
            },
            subTasksRunResult: {},
            subWorkflowsRunResult: {}
        });
    }

    public getResult<Result>(_id: string): Promise<WorkflowRunResult<Result>> {
        // TODO: get result from storage
        return Promise.resolve({
            state: "queued"
        });
    }

    public addSubTaskRunResult<TaskResult>(
        _workflowRunId: string, 
        _taskPath: string, 
        _taskResult: TaskRunResult<TaskResult>
    ): Promise<void> {
        // TODO: add in storage
        return Promise.resolve();
    }

    public getNextToExecute(): Promise<WorkflowRunRow<unknown, unknown> | null> {
        // TODO: fetch from storage or queue
        return Promise.resolve({
            id: "1",
            params: {} as WorkflowRunParams<unknown>,
            result: {
                state: "queued"
            },
            workflow: {
                path: "workflow-path"
            },
            subTasksRunResult: {},
            subWorkflowsRunResult: {}
        });
    }
}