import { NotFoundError } from "@aikirun/lib/error";
import { propsRequiredNonNull } from "@aikirun/lib/object";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type {
	WorkflowRunStateRequest,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
} from "@aikirun/types/api/workflow-run";
import type { WorkflowRunId, WorkflowRunState, WorkflowRunStatus } from "@aikirun/types/workflow/run";
import { isTerminalWorkflowRunStatus, WORKFLOW_RUN_SCHEDULED_REASONS } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { InvalidWorkflowRunStateTransitionError, WorkflowRunRevisionConflictError } from "../../errors";
import type { Repositories, TxRepositories } from "../../infra/db/types";
import type { UpdateWorkflowRunParams } from "../../infra/db/types/workflow-run";
import type { ImminentRunTimerQueue } from "../../infra/timer/imminent-run-timer-queue";
import type { NamespaceRequestContext } from "../../middleware/context";
import type { ChildRunCanceller } from "../cancel-child-runs";
import { deliverTerminatedSignalToParentRun } from "../deliver-terminated-signals";
import { discardStaleTasks } from "../discard-stale-tasks";

type StateTransitionValidation<Status extends WorkflowRunStatus> =
	Extract<WorkflowRunStateRequest, { status: Status }> extends { reason: `${infer Reason}` }
		? { reason: Reason | ReadonlySet<Reason> }
		: true;

const workflowRunStateTransitionValidator: Record<
	WorkflowRunStatus,
	Partial<{ [ToStatus in WorkflowRunStatus]: StateTransitionValidation<ToStatus> }>
> = {
	scheduled: {
		queued: { reason: new Set(WORKFLOW_RUN_SCHEDULED_REASONS) },
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
		queued: { reason: "task_retry" },
		running: true,
		paused: true,
		sleeping: true,
		awaiting_event: true,
		awaiting_retry: true,
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
		queued: { reason: "wakeup" },
		cancelled: true,
	},
	awaiting_event: {
		scheduled: { reason: "event" },
		queued: { reason: "event_wait_timeout" },
		cancelled: true,
	},
	awaiting_retry: {
		queued: { reason: "retry" },
		cancelled: true,
	},
	awaiting_child_workflow: {
		scheduled: { reason: "child_workflow" },
		queued: { reason: "child_workflow_wait_timeout" },
		cancelled: true,
	},
	stalled: {
		scheduled: { reason: "redelivery" },
		cancelled: true,
	},
	cancelled: {},
	completed: {},
	failed: {
		awaiting_retry: true,
	},
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
	childRunCanceller: ChildRunCanceller;
	imminentRunTimerQueue?: ImminentRunTimerQueue;
}

export const createWorkflowRunStateMachine = ({
	repos,
	childRunCanceller,
	imminentRunTimerQueue,
}: WorkflowRunStateMachineDeps) => ({
	async transitionState(
		context: NamespaceRequestContext,
		request: WorkflowRunTransitionStateRequestV1,
		txRepos?: TxRepositories
	): Promise<WorkflowRunTransitionStateResponseV1> {
		const response = txRepos
			? await transitionStateInTx(context, request, childRunCanceller, txRepos, imminentRunTimerQueue)
			: await repos.transaction(async (newTxRepos) =>
					transitionStateInTx(context, request, childRunCanceller, newTxRepos, imminentRunTimerQueue)
				);
		context.logger.info("Workflow state transition", {
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
	request: WorkflowRunTransitionStateRequestV1,
	childRunCanceller: ChildRunCanceller,
	txRepos: TxRepositories,
	imminentRunTimerQueue?: ImminentRunTimerQueue
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

	assertIsValidWorkflowRunStateTransition(runId, fromState, request.state);

	if (request.type === "optimistic" && run.revision !== request.expectedRevision) {
		throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
	}

	const now = Date.now() as TimestampMs;
	let toState = convertDurationToTimestamp(request.state, now);

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

	let attempts = run.attempts;
	if (toState.status === "scheduled" || toState.status === "queued") {
		switch (toState.reason) {
			case "retry":
				attempts++;
				break;
			default:
				toState.reason satisfies
					| "new"
					| "task_retry"
					| "wakeup"
					| "wakeup_early"
					| "resumption"
					| "event"
					| "event_wait_timeout"
					| "child_workflow"
					| "child_workflow_wait_timeout"
					| "recovery"
					| "redelivery";
		}
	}

	if (toState.status === "running") {
		await txRepos.workflowRunOutbox.markClaimed(namespaceId, runId);
	} else if (toState.status !== "queued") {
		await txRepos.workflowRunOutbox.deleteByWorkflowRunId({ namespaceId, workflowRunId: runId });
	}

	const stateTransitionId = ulid();

	const updatedRun = await updateWorkflowRun(
		context,
		runId,
		request,
		toState,
		stateTransitionId,
		attempts,
		now,
		txRepos
	);
	toState = updatedRun.state;

	await txRepos.stateTransition.append({
		id: stateTransitionId,
		workflowRunId: runId,
		type: "workflow_run",
		status: toState.status,
		attempt: attempts,
		state: toState,
	});

	if (imminentRunTimerQueue && toState.status === "scheduled") {
		txRepos.onCommit(() => imminentRunTimerQueue.add([{ id: runId, scheduledAt: toState.scheduledAt }]));
	}

	if (toState.status === "cancelled") {
		await discardStaleTasks(runId, ["running", "awaiting_retry"], txRepos);
		await childRunCanceller.cancel([{ namespaceId, id: runId, pool: run.options?.pool }], txRepos, context.logger);
	}

	if (isTerminalWorkflowRunStatus(toState.status) && propsRequiredNonNull(run, "parentWorkflowRunId")) {
		await deliverTerminatedSignalToParentRun(
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
	}

	return { revision: updatedRun.revision, state: toState, attempts };
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
	request: WorkflowRunTransitionStateRequestV1,
	toState: WorkflowRunState,
	stateTransitionId: string,
	attempts: number,
	now: TimestampMs,
	txRepos: TxRepositories
): Promise<{ revision: number; state: WorkflowRunState }> {
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
				attempts,
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

	let updates: Extract<UpdateWorkflowRunParams, { waitForSignal: false }>["updates"];
	if (toState.status === "scheduled") {
		updates = {
			status: toState.status,
			attempts,
			latestStateTransitionId: stateTransitionId,
			scheduledAt: toState.scheduledAt as TimestampMs,
		};
	} else if (toState.status === "sleeping") {
		updates = {
			status: toState.status,
			attempts,
			latestStateTransitionId: stateTransitionId,
			wakeupAt: toState.wakeupAt as TimestampMs,
		};
	} else if (toState.status === "awaiting_retry") {
		updates = {
			status: toState.status,
			attempts,
			latestStateTransitionId: stateTransitionId,
			nextAttemptAt: toState.nextAttemptAt as TimestampMs,
		};
	} else {
		updates = { status: toState.status, attempts, latestStateTransitionId: stateTransitionId };
	}

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

export function convertDurationToTimestamp(request: WorkflowRunStateRequest, now: TimestampMs): WorkflowRunState {
	if (request.status === "scheduled") {
		return {
			status: "scheduled",
			reason: request.reason,
			scheduledAt: now + request.scheduledInMs,
		};
	}

	if (request.status === "sleeping") {
		return {
			status: request.status,
			sleepName: request.sleepName,
			wakeupAt: now + request.durationMs,
		};
	}

	if (request.status === "awaiting_event" && request.timeoutInMs !== undefined) {
		return {
			status: request.status,
			eventName: request.eventName,
			timeoutAt: now + request.timeoutInMs,
		};
	}

	if (request.status === "awaiting_retry") {
		const nextAttemptAt = now + request.nextAttemptInMs;
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
		return {
			status: request.status,
			childWorkflowRunId: request.childWorkflowRunId,
			timeoutAt: now + request.timeoutInMs,
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
