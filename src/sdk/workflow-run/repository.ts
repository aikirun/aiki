import { TaskRunResult } from "../task/index.ts";
import { Workflow, WorkflowRunParams } from "../workflow/index.ts";
import { WorkflowRunRepository, WorkflowRunResult, WorkflowRunRow } from "./type.ts";

export class WorkflowRunRepositoryImpl implements WorkflowRunRepository {
    constructor() {}

    public create<Payload, Result>(
        _workflow: Workflow<Payload, Result>, 
        _runParams: WorkflowRunParams<Payload>
    ): Promise<WorkflowRunRow> {
        // TODO: submit workflow and payload to storage
		// don't run the actual code yet
		// check idempotency key if provided
        return Promise.resolve({
            id: "1",
            result: {
                state: "queued"
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
}