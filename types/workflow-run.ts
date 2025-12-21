import type { SerializableError } from "./error";
import type { RetryStrategy } from "./retry";
import type { SleepState } from "./sleep";
import type { TaskState } from "./task";
import type { TriggerStrategy } from "./trigger";

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
	| "completed"
	| "failed";

export type TerminalWorkflowRunStatus = "cancelled" | "completed" | "failed";

export type NonTerminalWorkflowRunStatus = Exclude<WorkflowRunStatus, TerminalWorkflowRunStatus>;

export interface WorkflowOptions {
	retry?: RetryStrategy;
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
	shardKey?: string;
}

interface WorkflowRunStateBase {
	status: WorkflowRunStatus;
}

export type WorkflowRunScheduledReason = "new" | "retry" | "awake" | "resume" | "event";

interface WorkflowRunStateScheduledBase extends WorkflowRunStateBase {
	status: "scheduled";
	scheduledAt: number;
	reason: WorkflowRunScheduledReason;
}

export interface WorkflowRunStateScheduledByNew extends WorkflowRunStateScheduledBase {
	reason: "new";
}

export interface WorkflowRunStateScheduledByRetry extends WorkflowRunStateScheduledBase {
	reason: "retry";
}

export interface WorkflowRunStateScheduledByAwake extends WorkflowRunStateScheduledBase {
	reason: "awake";
}

export interface WorkflowRunStateScheduledByResume extends WorkflowRunStateScheduledBase {
	reason: "resume";
}

export interface WorkflowRunStateScheduledByEvent extends WorkflowRunStateScheduledBase {
	reason: "event";
}

export type WorkflowRunStateScheduled =
	| WorkflowRunStateScheduledByNew
	| WorkflowRunStateScheduledByRetry
	| WorkflowRunStateScheduledByAwake
	| WorkflowRunStateScheduledByResume
	| WorkflowRunStateScheduledByEvent;

export interface WorkflowRunStateQueued extends WorkflowRunStateBase {
	status: "queued";
	reason: WorkflowRunScheduledReason;
}

export interface WorkflowRunStateRunning extends WorkflowRunStateBase {
	status: "running";
}

export interface WorkflowRunStatePaused extends WorkflowRunStateBase {
	status: "paused";
}

export interface WorkflowRunStateSleeping extends WorkflowRunStateBase {
	status: "sleeping";
	sleepPath: string;
	durationMs: number;
}

export interface WorkflowRunStateAwaitingEvent extends WorkflowRunStateBase {
	status: "awaiting_event";
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
	taskPath: string;
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

export interface WorkflowRunStateAwaitingChildWorkflow extends WorkflowRunStateBase {
	status: "awaiting_child_workflow";
}

export interface WorkflowRunStateCancelled extends WorkflowRunStateBase {
	status: "cancelled";
	reason?: string;
}

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
	taskPath: string;
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
	| WorkflowRunStateScheduled
	| WorkflowRunStateQueued
	| WorkflowRunStateRunning
	| WorkflowRunStatePaused
	| WorkflowRunStateSleeping
	| WorkflowRunStateAwaitingEvent
	| WorkflowRunStateAwaitingRetry
	| WorkflowRunStateAwaitingChildWorkflow
	| WorkflowRunStateCancelled
	| WorkflowRunStateFailed;

export type WorkflowRunState<Output> = WorkflowRunStateInComplete | WorkflowRunStateCompleted<Output>;

export interface WorkflowRun<Input = unknown, Output = unknown> {
	id: string;
	workflowId: string;
	workflowVersionId: string;
	createdAt: number;
	revision: number;
	input: Input;
	options: WorkflowOptions;
	attempts: number;
	state: WorkflowRunState<Output>;
	// TODO:
	// for workflows with a large number of tasks and/or deeply nested child workflows,
	// prefetching all results might be problematic.
	// Instead we might explore on-demand loading.
	// A hybrid approach is also possible, where we pre-fetch a chunk and load other chunks on demand
	tasksState: Record<string, TaskState<unknown>>;
	sleepsState: Record<string, SleepState>;
	childWorkflowsRunState: Record<string, WorkflowRunState<unknown>>;
}

export interface WorkflowRunTransitionBase {
	createdAt: number;
	type: "state" | "task_state";
}

export interface WorkflowRunStateTransition extends WorkflowRunTransitionBase {
	type: "state";
	state: WorkflowRunState<unknown>;
}

export interface WorkflowRunTaskStateTransition extends WorkflowRunTransitionBase {
	type: "task_state";
	taskPath: string;
	taskState: TaskState<unknown>;
}

export type WorkflowRunTransition = WorkflowRunStateTransition | WorkflowRunTaskStateTransition;

export class WorkflowRunConflictError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly operation: string,
		public readonly attempts: number
	) {
		super(`Conflict while performing ${operation} on workflow ${id} after ${attempts} attempts`);
		this.name = "WorkflowRunConflictError";
	}
}

export class WorkflowRunNotExecutableError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly status: WorkflowRunStatus
	) {
		super(`Workflow ${id} is not executable while ${status}`);
		this.name = "WorkflowRunNotExecutableError";
	}
}

export class WorkflowRunPausedError extends Error {
	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} paused`);
		this.name = "WorkflowRunPausedError";
	}
}

export class WorkflowRunCancelledError extends Error {
	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} cancelled`);
		this.name = "WorkflowRunCancelledError";
	}
}

export class WorkflowRunFailedError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly attempts: number,
		public readonly reason: string,
		public readonly failureCause?: WorkflowFailureCause
	) {
		super(`Workflow ${id} failed after ${attempts} attempt(s): ${reason}`);
		this.name = "WorkflowRunFailedError";
	}
}

export class WorkflowRunSuspendedError extends Error {
	constructor(public readonly id: WorkflowRunId) {
		super(`Workflow ${id} is suspended`);
		this.name = "WorkflowRunSuspendedError";
	}
}
