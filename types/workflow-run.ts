import type { EventQueue } from "./event";
import type { RetryStrategy } from "./retry";
import type { SerializableError } from "./serializable";
import type { SleepQueue } from "./sleep";
import type { TaskInfo, TaskState } from "./task";
import type { TriggerStrategy } from "./trigger";

export type WorkflowRunId = string & { _brand: "workflow_run_id" };
export type WorkflowRunPath = string & { _brand: "workflow_run_path" };

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

const terminalWorkflowRunStatuses = ["cancelled", "completed", "failed"] as const;
export type TerminalWorkflowRunStatus = (typeof terminalWorkflowRunStatuses)[number];

export type NonTerminalWorkflowRunStatus = Exclude<WorkflowRunStatus, TerminalWorkflowRunStatus>;

export function isTerminalWorkflowRunStatus(status: WorkflowRunStatus): status is TerminalWorkflowRunStatus {
	for (const terminalStatus of terminalWorkflowRunStatuses) {
		if (status === terminalStatus) {
			return true;
		}
	}
	return false;
}

export interface WorkflowReferenceOptions {
	id: string;
	onConflict?: "error" | "return_existing";
}

export interface WorkflowOptions {
	retry?: RetryStrategy;
	reference?: WorkflowReferenceOptions;
	trigger?: TriggerStrategy;
	shard?: string;
}

interface WorkflowRunStateBase {
	status: WorkflowRunStatus;
}

export type WorkflowRunScheduledReason =
	| "new"
	| "retry"
	| "task_retry"
	| "awake"
	| "awake_early"
	| "resume"
	| "event"
	| "child_workflow";

export interface WorkflowRunStateScheduledBase extends WorkflowRunStateBase {
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

export interface WorkflowRunStateScheduledByTaskRetry extends WorkflowRunStateScheduledBase {
	reason: "task_retry";
}

export interface WorkflowRunStateScheduledByAwake extends WorkflowRunStateScheduledBase {
	reason: "awake";
}

export interface WorkflowRunStateScheduledByAwakeEarly extends WorkflowRunStateScheduledBase {
	reason: "awake_early";
}

export interface WorkflowRunStateScheduledByResume extends WorkflowRunStateScheduledBase {
	reason: "resume";
}

export interface WorkflowRunStateScheduledByEvent extends WorkflowRunStateScheduledBase {
	reason: "event";
}

export interface WorkflowRunStateScheduledByChildWorkflow extends WorkflowRunStateScheduledBase {
	reason: "child_workflow";
}

export type WorkflowRunStateScheduled =
	| WorkflowRunStateScheduledByNew
	| WorkflowRunStateScheduledByRetry
	| WorkflowRunStateScheduledByTaskRetry
	| WorkflowRunStateScheduledByAwake
	| WorkflowRunStateScheduledByAwakeEarly
	| WorkflowRunStateScheduledByResume
	| WorkflowRunStateScheduledByEvent
	| WorkflowRunStateScheduledByChildWorkflow;

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
	sleepName: string;
	durationMs: number;
}

export interface WorkflowRunStateAwaitingEvent extends WorkflowRunStateBase {
	status: "awaiting_event";
	eventName: string;
	timeoutAt?: number;
}

export type WorkflowFailureCause = "task" | "child_workflow" | "self";

export interface WorkflowRunStateAwaitingRetryBase extends WorkflowRunStateBase {
	status: "awaiting_retry";
	cause: WorkflowFailureCause;
	nextAttemptAt: number;
}

export interface WorkflowRunStateAwaitingRetryCausedByTask extends WorkflowRunStateAwaitingRetryBase {
	cause: "task";
	taskId: string;
}

export interface WorkflowRunStateAwaitingRetryCausedByChildWorkflow extends WorkflowRunStateAwaitingRetryBase {
	cause: "child_workflow";
	childWorkflowRunId: string;
}

export interface WorkflowRunStateAwaitingRetryCausedBySelf extends WorkflowRunStateAwaitingRetryBase {
	cause: "self";
	error: SerializableError;
}

export type WorkflowRunStateAwaitingRetry =
	| WorkflowRunStateAwaitingRetryCausedByTask
	| WorkflowRunStateAwaitingRetryCausedByChildWorkflow
	| WorkflowRunStateAwaitingRetryCausedBySelf;

export interface WorkflowRunStateAwaitingChildWorkflow extends WorkflowRunStateBase {
	status: "awaiting_child_workflow";
	childWorkflowRunId: string;
	childWorkflowRunStatus: WorkflowRunStatus;
	timeoutAt?: number;
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
}

export interface WorkflowRunStateFailedByTask extends WorkflowRunStateFailedBase {
	cause: "task";
	taskId: string;
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

export type WorkflowRunState<Output = unknown> = WorkflowRunStateInComplete | WorkflowRunStateCompleted<Output>;

export interface WorkflowRun<Input = unknown, Output = unknown> {
	id: string;
	name: string;
	versionId: string;
	createdAt: number;
	revision: number;
	input: Input;
	path: string;
	options: WorkflowOptions;
	attempts: number;
	state: WorkflowRunState<Output>;
	// TODO:
	// for workflows with a large number of tasks and/or deeply nested child workflows,
	// prefetching all results might be problematic.
	// Instead we might explore on-demand loading.
	// A hybrid approach is also possible, where we pre-fetch a chunk and load other chunks on demand
	tasks: Record<string, TaskInfo>;
	sleepsQueue: Record<string, SleepQueue>;
	eventsQueue: Record<string, EventQueue<unknown>>;
	childWorkflowRuns: Record<string, ChildWorkflowRunInfo>;
	parentWorkflowRunId?: string;
}

export interface ChildWorkflowRunInfo {
	id: string;
	inputHash: string;
	statusWaitResults: ChildWorkflowWaitResult[];
}

export type ChildWorkflowWaitResult = ChildWorkflowWaitResultCompleted | ChildWorkflowWaitResultTimeout;

export interface ChildWorkflowWaitResultCompleted {
	status: "completed";
	completedAt: number;
	childWorkflowRunState: WorkflowRunState;
}

export interface ChildWorkflowWaitResultTimeout {
	status: "timeout";
	timedOutAt: number;
}

export interface WorkflowRunTransitionBase {
	id: string;
	createdAt: number;
	type: "state" | "task_state";
}

export interface WorkflowRunStateTransition extends WorkflowRunTransitionBase {
	type: "state";
	state: WorkflowRunState;
}

export interface WorkflowRunTaskStateTransition extends WorkflowRunTransitionBase {
	type: "task_state";
	taskId: string;
	taskState: TaskState;
}

export type WorkflowRunTransition = WorkflowRunStateTransition | WorkflowRunTaskStateTransition;

export class WorkflowRunNotExecutableError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly status: WorkflowRunStatus
	) {
		super(`Workflow ${id} is not executable while ${status}`);
		this.name = "WorkflowRunNotExecutableError";
	}
}

export class WorkflowRunSuspendedError extends Error {
	constructor(public readonly id: WorkflowRunId) {
		super(`Workflow ${id} is suspended`);
		this.name = "WorkflowRunSuspendedError";
	}
}

export class WorkflowRunFailedError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly attempts: number,
		public readonly reason?: string
	) {
		if (reason) {
			super(`Workflow ${id} failed after ${attempts} attempt(s): ${reason}`);
		} else {
			super(`Workflow ${id} failed after ${attempts} attempt(s)`);
		}
		this.name = "WorkflowRunFailedError";
	}
}

export class WorkflowRunConflictError extends Error {
	constructor(public readonly id: WorkflowRunId) {
		super(`Conflict while trying to update Workflow run ${id}`);
		this.name = "WorkflowRunConflictError";
	}
}
