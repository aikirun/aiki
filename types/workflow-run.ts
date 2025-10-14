import type { TaskState } from "./task.ts";
import type { TriggerStrategy } from "./trigger.ts";

export type WorkflowRunId = string & { _brand: "workflow_run_id" };

// TODO: revise these statuses
export type WorkflowRunStatus =
	| "scheduled"
	| "queued"
	| "starting"
	| "running"
	| "paused"
	| "sleeping"
	| "awaiting_event"
	| "awaiting_retry"
	| "awaiting_sub_workflow"
	| "cancelled"
	| "failed"
	| "completed";

export interface WorkflowOptions {
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
	shardKey?: string;
}

export interface WorkflowRunResultInComplete {
	status: Exclude<WorkflowRunStatus, "completed">;
}

export interface WorkflowRunResultComplete<Output> {
	status: "completed";
	output: Output;
}

export type WorkflowRunResult<Output> =
	| WorkflowRunResultInComplete
	| WorkflowRunResultComplete<Output>;

export interface WorkflowRun<Input, Output> {
	id: string;
	name: string;
	versionId: string;
	input: Input;
	options: WorkflowOptions;
	result: WorkflowRunResult<Output>;
	tasksState: Record<string, TaskState<unknown>>;
	subWorkflowsRunResult: Record<string, WorkflowRunResult<unknown>>;
}
