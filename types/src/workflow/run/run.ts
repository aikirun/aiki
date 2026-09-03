import type { RetryStrategy } from "@aikirun/lib/retry";
import type { SerializableError } from "@aikirun/lib/serializable";

import type { EventWait } from "./event";
import type { Sleep } from "./sleep";
import type { TriggerStrategy } from "./trigger";
import type { EncodedPayload } from "../../infra/codec";
import type { TaskInfo } from "../task";
import type { WorkflowSource } from "../workflow";

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
	"awaiting_task_retry",
	"awaiting_child_workflow",
	"stalled",
	"cancelled",
	"completed",
	"failed",
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const TERMINAL_WORKFLOW_RUN_STATUSES = ["cancelled", "completed", "failed"] as const;
export type TerminalWorkflowRunStatus = (typeof TERMINAL_WORKFLOW_RUN_STATUSES)[number];

export const NON_TERMINAL_WORKFLOW_RUN_STATUSES = WORKFLOW_RUN_STATUSES.filter(
	(status) => !(TERMINAL_WORKFLOW_RUN_STATUSES as unknown as string[]).includes(status)
);
export type NonTerminalWorkflowRunStatus = Exclude<WorkflowRunStatus, TerminalWorkflowRunStatus>;

export function isTerminalWorkflowRunStatus(status: WorkflowRunStatus): status is TerminalWorkflowRunStatus {
	for (const terminalStatus of TERMINAL_WORKFLOW_RUN_STATUSES) {
		if (status === terminalStatus) {
			return true;
		}
	}
	return false;
}

/**
 * The statuses a run can rest at while waiting for something external it to arrive, so a write into
 * one is guarded on the signal sequence.
 */
export type WaitingForSignalWorkflowRunStatus = "awaiting_event" | "awaiting_child_workflow";

export const WORKFLOW_RUN_CONFLICT_POLICIES = ["error", "return_existing"] as const;
export type WorkflowRunConflictPolicy = (typeof WORKFLOW_RUN_CONFLICT_POLICIES)[number];

export const CLIENT_CODECS = ["applied", "none"] as const;
export type ClientCodec = (typeof CLIENT_CODECS)[number];

export interface WorkflowReference {
	id: string;
	conflictPolicy?: WorkflowRunConflictPolicy;
}

export interface WorkflowRunOptions {
	retry?: RetryStrategy;
	pool?: string;
	/**
	 * Integer 0 (highest) to 9 (lowest), default 5. Breaks dispatch ties between runs due in the
	 * same millisecond; a run due earlier always dispatches first, whatever the priorities.
	 */
	priority?: number;
}

export interface WorkflowStartOptions extends WorkflowRunOptions {
	trigger?: TriggerStrategy;
	reference?: WorkflowReference;
}

interface WorkflowRunStateBase {
	status: WorkflowRunStatus;
}

export const WORKFLOW_RUN_SCHEDULED_REASONS = [
	"new",
	"wakeup_early",
	"resumption",
	"event",
	"child_workflow",
	"redelivery",
] as const;
export type WorkflowRunScheduledReason = (typeof WORKFLOW_RUN_SCHEDULED_REASONS)[number];

export function isWorkflowRunScheduledReason(reason: string): reason is WorkflowRunScheduledReason {
	for (const scheduledReason of WORKFLOW_RUN_SCHEDULED_REASONS) {
		if (reason === scheduledReason) {
			return true;
		}
	}
	return false;
}

export interface WorkflowRunStateScheduledBase extends WorkflowRunStateBase {
	status: "scheduled";
	scheduledAt: number;
	reason: WorkflowRunScheduledReason;
}

export interface WorkflowRunStateScheduledByNew extends WorkflowRunStateScheduledBase {
	reason: "new";
}

export interface WorkflowRunStateScheduledByWakeupEarly extends WorkflowRunStateScheduledBase {
	reason: "wakeup_early";
}

export interface WorkflowRunStateScheduledByResume extends WorkflowRunStateScheduledBase {
	reason: "resumption";
}

export interface WorkflowRunStateScheduledByEvent extends WorkflowRunStateScheduledBase {
	reason: "event";
}

export interface WorkflowRunStateScheduledByChildWorkflow extends WorkflowRunStateScheduledBase {
	reason: "child_workflow";
}

export interface WorkflowRunStateScheduledByRedelivery extends WorkflowRunStateScheduledBase {
	reason: "redelivery";
}

export type WorkflowRunStateScheduled =
	| WorkflowRunStateScheduledByNew
	| WorkflowRunStateScheduledByWakeupEarly
	| WorkflowRunStateScheduledByResume
	| WorkflowRunStateScheduledByEvent
	| WorkflowRunStateScheduledByChildWorkflow
	| WorkflowRunStateScheduledByRedelivery;

export const WORKFLOW_RUN_QUEUED_REASON = [
	"new",
	"retry",
	"task_retry",
	"wakeup",
	"wakeup_early",
	"resumption",
	"event",
	"event_wait_timeout",
	"child_workflow",
	"child_workflow_wait_timeout",
	"recovery",
	"redelivery",
] as const;
export type WorkflowRunQueuedReason = (typeof WORKFLOW_RUN_QUEUED_REASON)[number];

export interface WorkflowRunStateQueued extends WorkflowRunStateBase {
	status: "queued";
	reason: WorkflowRunQueuedReason;
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
	wakeupAt: number;
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

export interface WorkflowRunStateAwaitingTaskRetry extends WorkflowRunStateBase {
	status: "awaiting_task_retry";
	nextAttemptAt: number;
}

export interface WorkflowRunStateAwaitingChildWorkflow extends WorkflowRunStateBase {
	status: "awaiting_child_workflow";
	childWorkflowRunId: string;
	timeoutAt?: number;
}

export interface WorkflowRunStateStalled extends WorkflowRunStateBase {
	status: "stalled";
}

export interface WorkflowRunStateCancelled extends WorkflowRunStateBase {
	status: "cancelled";
	explanation?: string;
}

export interface WorkflowRunStateCompleted extends WorkflowRunStateBase {
	status: "completed";
	output: EncodedPayload;
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
	| WorkflowRunStateAwaitingTaskRetry
	| WorkflowRunStateAwaitingChildWorkflow
	| WorkflowRunStateStalled
	| WorkflowRunStateCancelled
	| WorkflowRunStateFailed;

export type WorkflowRunState = WorkflowRunStateInComplete | WorkflowRunStateCompleted;

export type TerminalWorkflowRunState = Extract<WorkflowRunState, { status: "cancelled" | "completed" | "failed" }>;

export interface WorkflowRunRecord {
	id: string;
	name: string;
	versionId: string;
	source: WorkflowSource;
	createdAt: number;
	revision: number;
	signalSequence: number;
	stateTransitionId: string;
	input: EncodedPayload;
	inputHash: string;
	clientCodec: ClientCodec;
	referenceId?: string;
	options?: WorkflowRunOptions;
	attempts: number;
	state: WorkflowRunState;
	// TODO:
	// for workflows with a large number of tasks/sleeps/eventWaits/childWorkflowRuns,
	// prefetching all results might be problematic.
	// Instead we might explore on-demand loading.
	// A hybrid approach is also possible, where we pre-fetch a chunk and load other chunks on demand
	tasks: Record<string, TaskInfo[]>;
	sleeps: Record<string, Sleep[]>;
	eventWaits: Record<string, EventWait<unknown>[]>;
	childWorkflowRuns: Record<string, ChildWorkflowRunInfo[]>;
	childWorkflowRunWaits: Record<string, ChildWorkflowRunWaits>;
	parentWorkflowRunId?: string;
	scheduleId?: string;
}

export interface ChildWorkflowRunInfo {
	id: string;
	name: string;
	versionId: string;
	inputHash: string;
}

export interface ChildWorkflowRunWaits {
	timeouts: {
		timedOutAt: number;
	}[];
	terminal?: {
		state: TerminalWorkflowRunState;
		completedAt: number;
	};
}
