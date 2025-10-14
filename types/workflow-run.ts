import type { TaskState } from "./task.ts";
import type { TriggerStrategy } from "./trigger.ts";
import type { SerializableError } from "./serializable.ts";

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
	status: Exclude<WorkflowRunStatus, "completed" | "failed">;
}

export interface WorkflowRunStateComplete<Output> {
	status: "completed";
	output: Output;
}

interface WorkflowRunStateFailedBase {
	status: "failed";
	reason: string;
}

export interface WorkflowRunStateFailedByTask extends WorkflowRunStateFailedBase {
	cause: "task";
	taskName: string;
}

export interface WorkflowRunStateFailedBySubWorkflow extends WorkflowRunStateFailedBase {
	cause: "sub_workflow";
	subWorkflowName: string;
}

export interface WorkflowRunStateFailedBySelf extends WorkflowRunStateFailedBase {
	cause: "self";
	error: SerializableError;
}

export type WorkflowRunStateFailed =
	| WorkflowRunStateFailedByTask
	| WorkflowRunStateFailedBySubWorkflow
	| WorkflowRunStateFailedBySelf;

export type WorkflowRunState<Output> =
	| WorkflowRunStateInComplete
	| WorkflowRunStateComplete<Output>
	| WorkflowRunStateFailed;

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
