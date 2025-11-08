import type { TaskState } from "./task.ts";
import type { TriggerStrategy } from "./trigger.ts";
import type { RetryStrategy } from "@aiki/lib/retry";
import type { SerializableError } from "./serializable.ts";

export type WorkflowRunId = string & { _brand: "workflow_run_id" };

export type WorkflowRunStatus =
	| "scheduled"
	| "queued"
	| "running"
	| "paused"
	| "sleeping"
	| "awaiting_event"
	| "awaiting_retry"
	| "awaiting_child_workflow"
	| "cancelled"
	| "failed"
	| "completed";

export interface WorkflowOptions {
	retry?: RetryStrategy;
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
	shardKey?: string;
}

interface WorkflowRunStateBase {
	status: WorkflowRunStatus;
}

export interface WorkflowRunStateOthers extends WorkflowRunStateBase {
	status: Exclude<
		WorkflowRunStatus,
		"scheduled" | "queued" | "running" | "sleeping" | "awaiting_retry" | "completed" | "failed"
	>;
}

export interface WorkflowRunStateScheduled extends WorkflowRunStateBase {
	status: "scheduled";
	scheduledAt: number;
}

export interface WorkflowRunStateQueued extends WorkflowRunStateBase {
	status: "queued";
	reason: "new" | "event" | "retry" | "awake";
}

export interface WorkflowRunStateRunning extends WorkflowRunStateBase {
	status: "running";
}

export interface WorkflowRunStateSleeping extends WorkflowRunStateBase {
	status: "sleeping";
	awakeAt: number;
}

export type WorkflowFailureCause = "task" | "child_workflow" | "self";

export interface WorkflowRunStateAwaitingBase extends WorkflowRunStateBase {
	status: "awaiting_retry";
	cause: WorkflowFailureCause;
	reason: string;
	nextAttemptAt: number;
}

export interface WorkflowRunStateAwaitingRetryCausedByTask extends WorkflowRunStateAwaitingBase {
	cause: "task";
	taskName: string;
}

export interface WorkflowRunStateAwaitingRetryCausedByChildWorkflow extends WorkflowRunStateAwaitingBase {
	cause: "child_workflow";
	childWorkflowRunId: string;
}

export interface WorkflowRunStateAwaitingRetryCausedBySelf extends WorkflowRunStateAwaitingBase {
	cause: "self";
	error: SerializableError;
}

export type WorkflowRunStateAwaitingRetry =
	| WorkflowRunStateAwaitingRetryCausedByTask
	| WorkflowRunStateAwaitingRetryCausedByChildWorkflow
	| WorkflowRunStateAwaitingRetryCausedBySelf;

export interface WorkflowRunStateCompleted<Output> extends WorkflowRunStateBase {
	status: "completed";
	output: Output;
}

interface WorkflowRunStateFailedBase extends WorkflowRunStateBase {
	status: "failed";
	cause: WorkflowFailureCause;
	reason: string;
}

export interface WorkflowRunStateFailedByTask extends WorkflowRunStateFailedBase {
	cause: "task";
	taskName: string;
}

export interface WorkflowRunStateFailedByChildWorkflow extends WorkflowRunStateFailedBase {
	cause: "child_workflow";
	childWorkflowRunId: string;
}

export interface WorkflowRunStateFailedBySelf extends WorkflowRunStateFailedBase {
	cause: "self";
	error: SerializableError;
}

export type WorkflowRunStateFailed =
	| WorkflowRunStateFailedByTask
	| WorkflowRunStateFailedByChildWorkflow
	| WorkflowRunStateFailedBySelf;

export type WorkflowRunStateInComplete =
	| WorkflowRunStateOthers
	| WorkflowRunStateScheduled
	| WorkflowRunStateSleeping
	| WorkflowRunStateQueued
	| WorkflowRunStateRunning
	| WorkflowRunStateAwaitingRetry
	| WorkflowRunStateFailed;

export type WorkflowRunState<Output> =
	| WorkflowRunStateInComplete
	| WorkflowRunStateCompleted<Output>;

export interface WorkflowRun<Input = unknown, Output = unknown> {
	id: string;
	name: string;
	versionId: string;
	revision: number;
	input: Input;
	options: WorkflowOptions;
	attempts: number;
	state: WorkflowRunState<Output>;
	tasksState: Record<string, TaskState<unknown>>;
	childWorkflowsRunState: Record<string, WorkflowRunState<unknown>>;
}
