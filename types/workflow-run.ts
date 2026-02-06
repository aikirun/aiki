import type { EventWaitQueue } from "./event";
import type { RetryStrategy } from "./retry";
import type { SerializableError } from "./serializable";
import type { SleepQueue } from "./sleep";
import type { TaskInfo } from "./task";
import type { TriggerStrategy } from "./trigger";

export type WorkflowRunId = string & { _brand: "workflow_run_id" };
export type WorkflowRunAddress = string & { _brand: "workflow_run_address" };

export const WORKFLOW_RUN_STATUSES = [
	"scheduled",
	"queued",
	"running",
	"paused",
	"sleeping",
	"awaiting_event",
	"awaiting_retry",
	"awaiting_child_workflow",
	"cancelled",
	"completed",
	"failed",
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

const TERMINAL_WORKFLOW_RUN_STATUSES = ["cancelled", "completed", "failed"] as const;
export type TerminalWorkflowRunStatus = (typeof TERMINAL_WORKFLOW_RUN_STATUSES)[number];

export type NonTerminalWorkflowRunStatus = Exclude<WorkflowRunStatus, TerminalWorkflowRunStatus>;

export function isTerminalWorkflowRunStatus(status: WorkflowRunStatus): status is TerminalWorkflowRunStatus {
	for (const terminalStatus of TERMINAL_WORKFLOW_RUN_STATUSES) {
		if (status === terminalStatus) {
			return true;
		}
	}
	return false;
}

export const WORKFLOW_RUN_CONFLICT_POLICIES = ["error", "return_existing"] as const;
export type WorkflowRunConflictPolicy = (typeof WORKFLOW_RUN_CONFLICT_POLICIES)[number];

export interface WorkflowReferenceOptions {
	id: string;
	conflictPolicy?: WorkflowRunConflictPolicy;
}

export interface WorkflowDefinitionOptions {
	retry?: RetryStrategy;
	trigger?: TriggerStrategy;
}

export interface WorkflowStartOptions extends WorkflowDefinitionOptions {
	reference?: WorkflowReferenceOptions;
	shard?: string;
}

interface WorkflowRunStateBase {
	status: WorkflowRunStatus;
}

export const WORKFLOW_RUN_SCHEDULED_REASON = [
	"new",
	"retry",
	"task_retry",
	"awake",
	"awake_early",
	"resume",
	"event",
	"child_workflow",
] as const;
export type WorkflowRunScheduledReason = (typeof WORKFLOW_RUN_SCHEDULED_REASON)[number];

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
	awakeAt: number;
}

export interface WorkflowRunStateAwaitingEvent extends WorkflowRunStateBase {
	status: "awaiting_event";
	eventName: string;
	timeoutAt?: number;
}

export const WORKFLOW_RUN_FAILURE_CAUSE = ["task", "child_workflow", "self"] as const;
export type WorkflowRunFailureCause = (typeof WORKFLOW_RUN_FAILURE_CAUSE)[number];

export interface WorkflowRunStateAwaitingRetryBase extends WorkflowRunStateBase {
	status: "awaiting_retry";
	cause: WorkflowRunFailureCause;
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
	childWorkflowRunStatus: TerminalWorkflowRunStatus;
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
	cause: WorkflowRunFailureCause;
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
	input?: Input;
	inputHash: string;
	address: string;
	options: WorkflowStartOptions;
	attempts: number;
	state: WorkflowRunState<Output>;
	// TODO:
	// for workflows with a large number of tasks/sleeps/eventWaits/childWorkflowRuns,
	// prefetching all results might be problematic.
	// Instead we might explore on-demand loading.
	// A hybrid approach is also possible, where we pre-fetch a chunk and load other chunks on demand
	tasks: Record<string, TaskInfo>;
	sleepsQueue: Record<string, SleepQueue>;
	eventWaitQueues: Record<string, EventWaitQueue<unknown>>;
	childWorkflowRuns: Record<string, ChildWorkflowRunInfo>;
	parentWorkflowRunId?: string;
}

export interface ChildWorkflowRunInfo {
	id: string;
	name: string;
	versionId: string;
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

export class WorkflowRunNotExecutableError extends Error {
	public readonly id: WorkflowRunId;
	public readonly status: WorkflowRunStatus;

	constructor(id: WorkflowRunId, status: WorkflowRunStatus) {
		super(`Workflow ${id} is not executable while ${status}`);
		this.name = "WorkflowRunNotExecutableError";
		this.id = id;
		this.status = status;
	}
}

export class WorkflowRunSuspendedError extends Error {
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} is suspended`);
		this.name = "WorkflowRunSuspendedError";
		this.id = id;
	}
}

export class WorkflowRunFailedError extends Error {
	public readonly id: WorkflowRunId;
	public readonly attempts: number;
	public readonly reason?: string;

	constructor(id: WorkflowRunId, attempts: number, reason?: string) {
		const message = reason
			? `Workflow ${id} failed after ${attempts} attempt(s): ${reason}`
			: `Workflow ${id} failed after ${attempts} attempt(s)`;
		super(message);
		this.name = "WorkflowRunFailedError";
		this.id = id;
		this.attempts = attempts;
		this.reason = reason;
	}
}

export class WorkflowRunRevisionConflictError extends Error {
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Conflict while trying to update Workflow run ${id}`);
		this.name = "WorkflowRunRevisionConflictError";
		this.id = id;
	}
}
