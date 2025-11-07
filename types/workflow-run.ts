import type { TaskState } from "./task.ts";
import type { TriggerStrategy } from "./trigger.ts";
import type { SerializableError } from "./serializable.ts";

export type WorkflowRunId = string & { _brand: "workflow_run_id" };

// TODO: rename sub to child
export type WorkflowRunStatus =
	| "scheduled"
	| "queued"
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

interface WorkflowRunStateBase {
	status: WorkflowRunStatus;
}

export interface WorkflowRunStateOthers extends WorkflowRunStateBase {
	status: Exclude<WorkflowRunStatus, "queued" | "completed" | "failed">;
}

export interface WorkflowRunStateQueued extends WorkflowRunStateBase {
	status: "queued";
	reason: "new" | "event" | "retry" | "awake";
}

export interface WorkflowRunStateCompleted<Output> extends WorkflowRunStateBase {
	status: "completed";
	output: Output;
}

interface WorkflowRunStateFailedBase extends WorkflowRunStateBase {
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
	| WorkflowRunStateOthers
	| WorkflowRunStateQueued
	| WorkflowRunStateCompleted<Output>
	| WorkflowRunStateFailed;

// TODO: set default to unknown, unknown
export interface WorkflowRun<Input, Output> {
	id: string;
	name: string;
	versionId: string;
	revision: number;
	input: Input;
	options: WorkflowOptions;
	state: WorkflowRunState<Output>;
	tasksState: Record<string, TaskState<unknown>>;
	subWorkflowsRunState: Record<string, WorkflowRunState<unknown>>;
}
