import type { TaskRunResult } from "./task-run.ts";
import type { TriggerStrategy } from "./trigger.ts";

export type WorkflowRunId = string & { _brand: "workflow_run_id" };

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
	state: Exclude<WorkflowRunState, "completed">;
}

export interface WorkflowRunResultComplete<Output> {
	state: "completed";
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
	subTasksRunResult: Record<string, TaskRunResult<unknown>>;
	subWorkflowsRunResult: Record<string, WorkflowRunResult<unknown>>;
}
