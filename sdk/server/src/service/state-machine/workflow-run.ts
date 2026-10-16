import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import { NotFoundError, ValidationError } from "@aikirun/lib/error";
import { propsRequiredNonNull } from "@aikirun/lib/object";
import { MAX_TIMESTAMP_MS, type TimestampMs } from "@aikirun/lib/timestamp";
import type {
	WorkflowRunStateRequest,
	WorkflowRunStateScheduledRequest,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
} from "@aikirun/types/api/workflow-run";
import type { TimerType } from "@aikirun/types/infra/timer";
import type {
	WaitingForSignalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateStalled,
	WorkflowRunStatus,
} from "@aikirun/types/workflow/run";
import { isTerminalWorkflowRunStatus } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { InvalidWorkflowRunStateTransitionError, WorkflowRunRevisionConflictError } from "../../errors";
import type { Repositories, TxRepositories } from "../../infra/db/types";
import type { ImminentTimerQueue } from "../../infra/timer/imminent-timer-queue";
import type { NamespaceRequestContext } from "../../middleware/context";
import { cancelChildRuns } from "../cancel-child-runs";
import { deliverTerminatedSignalToParentRun } from "../deliver-terminated-signals";
import { discardStaleTasks } from "../discard-stale-tasks";

type TransitionedWorkflowRunState = Exclude<WorkflowRunState, { status: "queued" }>;

/** The moves the API accepts, plus the ones only the server's own code may make. */
type WorkflowRunTransitionStateRequest =
	| WorkflowRunTransitionStateRequestV1
	| {
			type: "optimistic";
			id: string;
			expectedRevision: number;
			state: Extract<WorkflowRunStateScheduledRequest, { reason: "event" | "child_workflow" }>;
	  }
	| { type: "pessimistic"; id: string; state: WorkflowRunStateStalled };

type StateTransitionValidation<Status extends WorkflowRunStateRequest["status"]> =
	Extract<WorkflowRunStateRequest, { status: Status }> extends { reason: `${infer Reason}` }
		? { reason: Reason | ReadonlySet<Reason> }
		: true;

const workflowRunStateTransitionValidator: Record<
	WorkflowRunStatus,
	Partial<{ [ToStatus in WorkflowRunStateRequest["status"]]: StateTransitionValidation<ToStatus> }>
> = {
	scheduled: {
		paused: true,
		cancelled: true,
	},
	queued: {
		running: true,
		paused: true,
		cancelled: true,
		failed: true,
		stalled: true,
	},
	running: {
		running: true,
		paused: true,
		sleeping: true,
		awaiting_event: true,
		awaiting_retry: true,
		awaiting_task_retry: true,
		awaiting_child_workflow: true,
		cancelled: true,
		completed: true,
		failed: true,
	},
	paused: {
		scheduled: { reason: "resumption" },
		cancelled: true,
	},
	sleeping: {
		scheduled: { reason: "wakeup_early" },
		cancelled: true,
	},
	awaiting_event: {
		scheduled: { reason: "event" },
		cancelled: true,
	},
	awaiting_retry: {
		cancelled: true,
	},
	awaiting_task_retry: {
		cancelled: true,
	},
	awaiting_child_workflow: {
		scheduled: { reason: "child_workflow" },
		cancelled: true,
	},
	stalled: {
		scheduled: { reason: "redelivery" },
		cancelled: true,
	},
	cancelled: {},
	completed: {},
	failed: {},
};

export function assertIsValidWorkflowRunStateTransition(
	runId: WorkflowRunId,
	from: WorkflowRunState,
	to: WorkflowRunStateRequest
) {
	const validator = workflowRunStateTransitionValidator[from.status][to.status];
	if (validator) {
		if (typeof validator === "boolean") {
			validator satisfies true;
			return;
		}
		if ("reason" in validator && "reason" in to) {
			const allowedReasons: string | ReadonlySet<string> = validator.reason;
			const isValidReason =
				typeof allowedReasons === "string" ? allowedReasons === to.reason : allowedReasons.has(to.reason);
			if (isValidReason) {
				return;
			}
			throw new InvalidWorkflowRunStateTransitionError(
				runId,
				from.status,
				to.status,
				`${to.reason} reason not allowed`
			);
		}
	}

	throw new InvalidWorkflowRunStateTransitionError(runId, from.status, to.status);
}

export interface WorkflowRunStateMachineDeps {
	repos: Repositories;
	imminentTimerQueue?: ImminentTimerQueue;
}

export const createWorkflowRunStateMachine = ({ repos, imminentTimerQueue }: WorkflowRunStateMachineDeps) => ({
	async transitionState(
		context: NamespaceRequestContext,
		request: WorkflowRunTransitionStateRequest,
		txRepos?: TxRepositories
	): Promise<WorkflowRunTransitionStateResponseV1> {
		const response = txRepos
			? await transitionStateInTx(context, request, txRepos, imminentTimerQueue)
			: await repos.transaction(async (newTxRepos) =>
					transitionStateInTx(context, request, newTxRepos, imminentTimerQueue)
				);
		context.logger.debug("Workflow state transition", {
			"aiki.runId": request.id,
			"aiki.state": response.state,
			"aiki.attempts": response.attempts,
		});
		return response;
	},
});

export type WorkflowRunStateMachine = ReturnType<typeof createWorkflowRunStateMachine>;

async function transitionStateInTx(
	context: NamespaceRequestContext,
	request: WorkflowRunTransitionStateRequest,
	txRepos: TxRepositories,
	imminentTimerQueue?: ImminentTimerQueue
): Promise<WorkflowRunTransitionStateResponseV1> {
	const namespaceId = context.namespaceId;
	const runId = request.id as WorkflowRunId;

	const result = await txRepos.workflowRun.getByIdWithState(
		{ namespaceId, id: runId },
		request.type === "pessimistic" ? { lock: "update" } : undefined
	);
	if (!result) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	const { run, state: fromState } = result;

	if (request.type === "optimistic" && run.revision !== request.expectedRevision) {
		throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
	}

	assertIsValidWorkflowRunStateTransition(runId, fromState, request.state);

	const now = Date.now() as TimestampMs;
	let toState: TransitionedWorkflowRunState;
	if (request.state.status === "awaiting_task_retry") {
		const nextAttemptAt = await txRepos.task.getEarliestNextAttemptAt(runId);
		if (nextAttemptAt === null) {
			throw new InvalidWorkflowRunStateTransitionError(
				runId,
				fromState.status,
				request.state.status,
				"no task awaiting retry"
			);
		}
		toState = { status: "awaiting_task_retry", nextAttemptAt };
	} else {
		toState = convertDurationToTimestamp(request.state, now);
	}

	if (fromState.status === "sleeping" && (toState.status === "scheduled" || toState.status === "cancelled")) {
		await cancelSleep(runId, fromState.sleepName, now, txRepos);
	}

	if (toState.status === "sleeping") {
		await txRepos.sleep.create({
			id: ulid(),
			workflowRunId: runId,
			name: toState.sleepName,
			status: "sleeping",
			wakeupAt: toState.wakeupAt as TimestampMs,
		});
	}

	if (toState.status === "running") {
		await txRepos.workflowRunOutbox.markClaimed(namespaceId, runId);
	} else {
		await txRepos.workflowRunOutbox.deleteByWorkflowRunId({ namespaceId, workflowRunId: runId });
	}

	const stateTransitionId = ulid();

	const updatedRun = await updateWorkflowRun(context, runId, request, toState, stateTransitionId, now, txRepos);
	toState = updatedRun.state;

	await txRepos.stateTransition.append({
		id: stateTransitionId,
		workflowRunId: runId,
		type: "workflow_run",
		attempt: run.attempts,
		revision: updatedRun.revision,
		state: toState,
	});

	if (imminentTimerQueue) {
		const timer = extractTimer(toState);
		if (timer) {
			txRepos.onCommit(() => imminentTimerQueue.add([{ ...timer, id: runId, priority: run.options?.priority }]));
		}
	}

	if (toState.status === "cancelled") {
		await discardStaleTasks([{ id: runId, revision: updatedRun.revision }], ["running", "awaiting_retry"], txRepos);
		const childCancellationTimers = await cancelChildRuns(
			[{ namespaceId, id: runId, pool: run.options?.pool, priority: run.options?.priority }],
			txRepos,
			context.logger
		);
		if (imminentTimerQueue && isNonEmptyArray(childCancellationTimers)) {
			txRepos.onCommit(() => imminentTimerQueue.add(childCancellationTimers));
		}
	}

	if (isTerminalWorkflowRunStatus(toState.status) && propsRequiredNonNull(run, "parentWorkflowRunId")) {
		const parentWakeTimers = await deliverTerminatedSignalToParentRun(
			[
				{
					namespaceId,
					id: run.id,
					latestStateTransitionId: stateTransitionId,
					parentWorkflowRunId: run.parentWorkflowRunId,
					status: toState.status,
				},
			],
			now,
			txRepos,
			context.logger
		);
		if (imminentTimerQueue && isNonEmptyArray(parentWakeTimers)) {
			txRepos.onCommit(() => imminentTimerQueue.add(parentWakeTimers));
		}
	}

	return { revision: updatedRun.revision, state: toState, attempts: run.attempts };
}

async function cancelSleep(runId: WorkflowRunId, sleepName: string, now: TimestampMs, txRepos: TxRepositories) {
	const activeSleep = await txRepos.sleep.getActiveByWorkflowRunIdAndName(runId, sleepName);
	if (!activeSleep) {
		return;
	}

	await txRepos.sleep.update(activeSleep.id, {
		status: "cancelled",
		cancelledAt: now,
	});
}

async function updateWorkflowRun(
	context: NamespaceRequestContext,
	runId: WorkflowRunId,
	request: WorkflowRunTransitionStateRequest,
	toState: TransitionedWorkflowRunState,
	stateTransitionId: string,
	now: TimestampMs,
	txRepos: TxRepositories
): Promise<{ revision: number; state: TransitionedWorkflowRunState }> {
	const { namespaceId } = context;

	if (toState.status === "awaiting_event" || toState.status === "awaiting_child_workflow") {
		if (request.type !== "optimistic" || !("expectedSignalSequence" in request)) {
			// The request contract makes this impossible.
			throw new Error(`Wait transition without expectedSignalSequence for run: ${runId}`);
		}

		const result = await txRepos.workflowRun.update({
			waitForSignal: true,
			filter: {
				namespaceId,
				id: runId,
				revision: request.expectedRevision,
				signalSequence: request.expectedSignalSequence,
			},
			updates: {
				latestStateTransitionId: stateTransitionId,
				onSignalSequenceMatch: {
					status: toState.status,
					timeoutAt: toState.timeoutAt !== undefined ? (toState.timeoutAt as TimestampMs) : null,
				},
				onSignalSequenceMismatch: { status: "scheduled", scheduledAt: now },
			},
		});
		if (!result) {
			throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
		}

		if (result.signalSequence !== request.expectedSignalSequence) {
			// TODO: gather metrics on false re-schedules.
			// This can happen when sequence was moved by an unrelated signal like an
			// event different from the one we attempted to wait on.
			// My bet is that these are rare occurrences, but if they bite, we'll need
			// find a solution, possibly querying the db to see if a re-schedule can be skipped.
			if (toState.status === "awaiting_event") {
				return {
					revision: result.revision,
					state: { status: "scheduled", reason: "event", scheduledAt: now },
				};
			} else {
				toState.status satisfies "awaiting_child_workflow";
				return {
					revision: result.revision,
					state: { status: "scheduled", reason: "child_workflow", scheduledAt: now },
				};
			}
		}

		return { revision: result.revision, state: toState };
	}

	const updates = {
		status: toState.status,
		latestStateTransitionId: stateTransitionId,
		...extractDueTimestamp(toState),
	};

	if (request.type === "optimistic") {
		const result = await txRepos.workflowRun.update({
			waitForSignal: false,
			filter: { namespaceId, id: runId, revision: request.expectedRevision },
			updates,
		});
		if (!result) {
			throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
		}
		return { revision: result.revision, state: toState };
	} else {
		const result = await txRepos.workflowRun.update({
			waitForSignal: false,
			filter: { namespaceId, id: runId },
			updates,
		});
		if (!result) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		return { revision: result.revision, state: toState };
	}
}

function extractDueTimestamp(state: Exclude<WorkflowRunState, { status: WaitingForSignalWorkflowRunStatus }>) {
	switch (state.status) {
		case "scheduled":
			return { scheduledAt: state.scheduledAt as TimestampMs };
		case "sleeping":
			return { wakeupAt: state.wakeupAt as TimestampMs };
		case "awaiting_retry":
		case "awaiting_task_retry":
			return { nextAttemptAt: state.nextAttemptAt as TimestampMs };
		default:
			state satisfies {
				status: WorkflowRunStatus;
				scheduledAt?: never;
				wakeupAt?: never;
				nextAttemptAt?: never;
				timeoutAt?: never;
			};
			return {};
	}
}

function extractTimer(state: WorkflowRunState): { type: TimerType; dueAt: number } | undefined {
	switch (state.status) {
		case "scheduled":
			return { type: "scheduled", dueAt: state.scheduledAt };
		case "sleeping":
			return { type: "sleep", dueAt: state.wakeupAt };
		case "awaiting_retry":
			return { type: "retry", dueAt: state.nextAttemptAt };
		case "awaiting_task_retry":
			return { type: "task_retry", dueAt: state.nextAttemptAt };
		case "awaiting_event": {
			if (state.timeoutAt === undefined) {
				return undefined;
			}
			return { type: "event_wait_timeout", dueAt: state.timeoutAt };
		}
		case "awaiting_child_workflow": {
			if (state.timeoutAt === undefined) {
				return undefined;
			}
			return { type: "child_wait_timeout", dueAt: state.timeoutAt };
		}
		case "queued":
		case "running":
		case "paused":
		case "stalled":
		case "cancelled":
		case "completed":
		case "failed":
			return undefined;
		default:
			return state satisfies never;
	}
}

export function convertDurationToTimestamp(
	request: Exclude<WorkflowRunStateRequest, { status: "awaiting_task_retry" }>,
	now: TimestampMs
): TransitionedWorkflowRunState {
	if (request.status === "scheduled") {
		const scheduledAt = now + request.scheduledInMs;
		assertIsValidTimestamp(scheduledAt);
		return {
			status: "scheduled",
			reason: request.reason,
			scheduledAt,
		};
	}

	if (request.status === "sleeping") {
		const wakeupAt = now + request.durationMs;
		assertIsValidTimestamp(wakeupAt);
		return {
			status: request.status,
			sleepName: request.sleepName,
			wakeupAt,
		};
	}

	if (request.status === "awaiting_event" && request.timeoutInMs !== undefined) {
		const timeoutAt = now + request.timeoutInMs;
		assertIsValidTimestamp(timeoutAt);
		return {
			status: request.status,
			eventName: request.eventName,
			timeoutAt,
		};
	}

	if (request.status === "awaiting_retry") {
		const nextAttemptAt = now + request.nextAttemptInMs;
		assertIsValidTimestamp(nextAttemptAt);
		switch (request.cause) {
			case "task":
				return {
					status: request.status,
					cause: request.cause,
					taskId: request.taskId,
					nextAttemptAt,
				};
			case "child_workflow":
				return {
					status: request.status,
					cause: request.cause,
					childWorkflowRunId: request.childWorkflowRunId,
					nextAttemptAt,
				};
			case "self":
				return {
					status: request.status,
					cause: request.cause,
					error: request.error,
					nextAttemptAt,
				};
		}
	}

	if (request.status === "awaiting_child_workflow" && request.timeoutInMs !== undefined) {
		const timeoutAt = now + request.timeoutInMs;
		assertIsValidTimestamp(timeoutAt);
		return {
			status: request.status,
			childWorkflowRunId: request.childWorkflowRunId,
			timeoutAt,
		};
	}

	if (request.status === "completed") {
		return {
			status: request.status,
			output: request.output,
		};
	}

	return request;
}

function assertIsValidTimestamp(timestamp: number): void {
	if (timestamp > MAX_TIMESTAMP_MS) {
		throw new ValidationError("The duration is too long: it ends after the year 9999");
	}
}
