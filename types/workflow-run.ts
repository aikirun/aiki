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

export interface WorkflowRunStateInComplete {
	status: Exclude<WorkflowRunStatus, "completed">;
}

export interface WorkflowRunStateComplete<Output> {
	status: "completed";
	output: Output;
}

export type WorkflowRunState<Output> =
	| WorkflowRunStateInComplete
	| WorkflowRunStateComplete<Output>;

export interface WorkflowRun<Input, Output> {
	id: string;
	name: string;
	versionId: string;
	input: Input;
	options: WorkflowOptions;
	state: WorkflowRunState<Output>;
	tasksState: Record<string, TaskState<unknown>>;
	subWorkflowsRunState: Record<string, WorkflowRunState<unknown>>;
}
