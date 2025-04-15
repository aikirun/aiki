import { TaskRunResult } from "../task/index.ts";
import { Workflow, WorkflowRunParams } from "../workflow/index.ts";

export interface WorkflowRun<Payload, Result> {
	id: string;
	path: string;
	params: WorkflowRunParams<Payload>;
	
	getResult: () => Promise<WorkflowRunResult<Result>>;

	_getSubTaskRunResult: <TaskResult>(taskPath: string) => TaskRunResult<TaskResult>;
	_addSubTaskRunResult: <TaskResult>(taskPath: string, taskResult: TaskRunResult<TaskResult>) => Promise<void>;
}

// TODO: revise these states
export type WorkflowRunState = 
	| "scheduled"
	| "queued"
	| "starting"
	| "running"
	| "paused"
	| "sleeping"
	| "awaiting_event"
	| "awaiting_retry"
	| "cancelled" 
	| "failed" 
	| "completed";

export type WorkflowRunResult<Result> =
	| {
		state: Exclude<WorkflowRunState, "completed">;
	}
	| {
		state: "completed";
		result: Result;
	};

export interface WorkflowRunRow {
    id: string;
    subTasksRunResult: Record<string, TaskRunResult<unknown>>,
    subWorkflowsRunResult: Record<string, WorkflowRunResult<unknown>>,
}

export interface WorkflowRunRepository {
    create: <Payload, Result>(
        workflow: Workflow<Payload, Result>, 
        workflowRunParams: WorkflowRunParams<Payload>
    ) => Promise<WorkflowRunRow>;

    getResult: <Result>(workflowRunId: string) => Promise<WorkflowRunResult<Result>>;

    addSubTaskRunResult: <TaskResult>(
        workflowRunId: string, 
        taskPath: string, 
        taskResult: TaskRunResult<TaskResult>
    ) => Promise<void>;
}