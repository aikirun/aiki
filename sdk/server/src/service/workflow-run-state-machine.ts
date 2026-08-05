import { NotFoundError } from "@aikirun/lib/error";
import { propsRequiredNonNull } from "@aikirun/lib/object";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type {
	WorkflowRunStateRequest,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
} from "@aikirun/types/api/workflow-run";
import type {
	TerminalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateAwaitingChildWorkflow,
	WorkflowRunStatus,
} from "@aikirun/types/workflow/run";
import { isTerminalWorkflowRunStatus, isWorkflowRunScheduledReason } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import { InvalidWorkflowRunStateTransitionError, WorkflowRunRevisionConflictError } from "../errors";
import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";
import type { ChildRunCanceller } from "../service/cancel-child-runs";
import { discardStaleTasks } from "../service/discard-stale-tasks";

type StateTransitionValidation = { allowed: true } | { allowed: false; reason?: string };

const workflowRunStateTransitionValidator: Record<
	WorkflowRunStatus,
	(to: WorkflowRunStateRequest) => StateTransitionValidation
> = {
	scheduled: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["queued", "paused", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "queued" && !isWorkflowRunScheduledReason(to.reason)) {
				return { allowed: false, reason: "Only scheduled reasons allowed" };
			}
			return { allowed: true };
		};
	})(),

	queued: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["running", "paused", "cancelled", "failed", "stalled"];
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
	})(),

	running: (() => {
		const allowedDestinations: WorkflowRunStatus[] = [
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
		];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "queued" && to.reason !== "task_retry") {
				return { allowed: false, reason: "Only task_retry run allowed" };
			}
			return { allowed: true };
		};
	})(),

	paused: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "resumption") {
				return { allowed: false, reason: "Only resumption run allowed" };
			}
			return { allowed: true };
		};
	})(),

	sleeping: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "queued", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "wakeup_early") {
				return { allowed: false, reason: "Only wakeup_early run allowed" };
			}
			if (to.status === "queued" && to.reason !== "wakeup") {
				return { allowed: false, reason: "Only wakeup run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_event: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "queued", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "event") {
				return { allowed: false, reason: "Only event received run allowed" };
			}
			if (to.status === "queued" && to.reason !== "event_wait_timeout") {
				return { allowed: false, reason: "Only event_wait_timeout run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_retry: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["queued", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "queued" && to.reason !== "retry") {
				return { allowed: false, reason: "Only retry run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_child_workflow: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "queued", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "child_workflow") {
				return { allowed: false, reason: "Only child workflow triggered run allowed" };
			}
			if (to.status === "queued" && to.reason !== "child_workflow_wait_timeout") {
				return { allowed: false, reason: "Only child_workflow_wait_timeout run allowed" };
			}
			return { allowed: true };
		};
	})(),

	stalled: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "redelivery") {
				return { allowed: false, reason: "Only redelivery allowed" };
			}
			return { allowed: true };
		};
	})(),

	cancelled: (() => {
		const allowedDestinations: WorkflowRunStatus[] = [];
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
	})(),

	completed: (() => {
		const allowedDestinations: WorkflowRunStatus[] = [];
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
	})(),

	failed: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["awaiting_retry"];
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
	})(),
};

export function assertIsValidWorkflowRunStateTransition(
	runId: WorkflowRunId,
	from: WorkflowRunState,
	to: WorkflowRunStateRequest
) {
	const result = workflowRunStateTransitionValidator[from.status](to);
	if (!result.allowed) {
		throw new InvalidWorkflowRunStateTransitionError(runId, from.status, to.status, result.reason);
	}
}

type TxRepos = Pick<
	Repositories,
	"workflowRun" | "workflow" | "stateTransition" | "sleep" | "task" | "childWorkflowRunWait" | "workflowRunOutbox"
>;

export interface WorkflowRunStateMachineServiceDeps {
	repos: TxRepos & Pick<Repositories, "transaction">;
	childRunCanceller: ChildRunCanceller;
}

export const createWorkflowRunStateMachineService = ({
	repos,
	childRunCanceller,
}: WorkflowRunStateMachineServiceDeps) => ({
	async transitionState(
		context: NamespaceRequestContext,
		request: WorkflowRunTransitionStateRequestV1,
		txRepos?: TxRepos
	): Promise<WorkflowRunTransitionStateResponseV1> {
		const response = txRepos
			? await transitionStateInTx(context, request, childRunCanceller, txRepos)
			: await repos.transaction(async (newTxRepos) =>
					transitionStateInTx(context, request, childRunCanceller, newTxRepos)
				);
		context.logger.info("Workflow state transition", {
			"aiki.runId": request.id,
			"aiki.state": response.state,
			"aiki.attempts": response.attempts,
		});
		return response;
	},
});

export type WorkflowRunStateMachineService = ReturnType<typeof createWorkflowRunStateMachineService>;

async function transitionStateInTx(
	context: NamespaceRequestContext,
	request: WorkflowRunTransitionStateRequestV1,
	childRunCanceller: ChildRunCanceller,
	txRepos: TxRepos
): Promise<WorkflowRunTransitionStateResponseV1> {
	const namespaceId = context.namespaceId;
	const runId = request.id as WorkflowRunId;

	const run = await txRepos.workflowRun.getByIdWithState(namespaceId, runId, {
		forUpdate: request.type === "pessimistic",
	});
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	const fromState = run.state;

	assertIsValidWorkflowRunStateTransition(runId, fromState, request.state);

	if (request.type === "optimistic" && run.revision !== request.expectedRevision) {
		throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
	}

	const now = Date.now();
	let toState = convertDurationToTimestamp(request.state, now);

	if (fromState.status === "sleeping" && toState.status === "scheduled") {
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
		await txRepos.workflowRunOutbox.deleteByWorkflowRunId(namespaceId, runId);
	}

	if (toState.status === "awaiting_child_workflow") {
		if (await childWorkflowRunWaitNotNeeded(context, runId, toState, now, txRepos)) {
			toState = { status: "scheduled", scheduledAt: now, reason: "child_workflow" };
		}
	}

	const stateTransitionId = ulid();
	await txRepos.stateTransition.append({
		id: stateTransitionId,
		workflowRunId: runId,
		type: "workflow_run",
		status: toState.status,
		attempt: attempts,
		state: toState,
	});

	const newRevision = await updateWorkflowRun(runId, request, toState, stateTransitionId, attempts, txRepos);

	if (toState.status === "cancelled") {
		await discardStaleTasks(runId, ["running", "awaiting_retry"], txRepos);
		await childRunCanceller.cancel([{ namespaceId, runId, pool: run.options?.pool }], txRepos, context.logger);
	}

	if (isTerminalWorkflowRunStatus(toState.status) && propsRequiredNonNull(run, "parentWorkflowRunId")) {
		await notifyParentOfStateChangeIfNecessary(
			context,
			{
				id: run.id,
				latestStateTransitionId: stateTransitionId,
				parentWorkflowRunId: run.parentWorkflowRunId,
				status: toState.status,
			},
			now,
			childRunCanceller,
			txRepos
		);
	}

	return { revision: newRevision, state: toState, attempts };
}

async function cancelSleep(runId: WorkflowRunId, sleepName: string, now: number, txRepos: TxRepos) {
	const activeSleep = await txRepos.sleep.getActiveByWorkflowRunIdAndName(runId, sleepName);
	if (!activeSleep) {
		return;
	}

	await txRepos.sleep.update(activeSleep.id, {
		status: "cancelled",
		cancelledAt: now as TimestampMs,
	});
}

async function childWorkflowRunWaitNotNeeded(
	{ namespaceId, logger }: NamespaceRequestContext,
	runId: WorkflowRunId,
	toState: WorkflowRunStateAwaitingChildWorkflow,
	now: number,
	txRepos: TxRepos
) {
	const childRunId = toState.childWorkflowRunId as WorkflowRunId;
	const childRun = await txRepos.workflowRun.getByIdWithState(namespaceId, childRunId);
	if (!childRun) {
		throw new NotFoundError(`Workflow run not found: ${childRunId}`);
	}

	if (childRun.status === toState.childWorkflowRunStatus || isTerminalWorkflowRunStatus(childRun.status)) {
		await txRepos.childWorkflowRunWait.insert({
			id: ulid(),
			parentWorkflowRunId: runId,
			childWorkflowRunId: childRunId,
			childWorkflowRunStatus: toState.childWorkflowRunStatus,
			status: "completed",
			completedAt: now as TimestampMs,
			childWorkflowRunStateTransitionId: childRun.latestStateTransitionId,
		});

		logger.info("Child already at status, scheduling immediately", {
			"aiki.runId": runId,
			"aiki.childRunId": childRunId,
			"aiki.childRunStatus": childRun.status,
		});

		return true;
	}

	return false;
}

async function updateWorkflowRun(
	runId: WorkflowRunId,
	request: WorkflowRunTransitionStateRequestV1,
	toState: WorkflowRunState,
	stateTransitionId: string,
	attempts: number,
	txRepos: TxRepos
): Promise<number> {
	const updates: Record<string, unknown> = {
		status: toState.status,
		attempts,
		latestStateTransitionId: stateTransitionId,
		scheduledAt: null,
		wakeupAt: null,
		timeoutAt: null,
		nextAttemptAt: null,
	};
	if (toState.status === "scheduled") {
		updates.scheduledAt = toState.scheduledAt as TimestampMs;
	} else if (toState.status === "sleeping") {
		updates.wakeupAt = toState.wakeupAt as TimestampMs;
	} else if (
		(toState.status === "awaiting_event" || toState.status === "awaiting_child_workflow") &&
		toState.timeoutAt !== undefined
	) {
		updates.timeoutAt = toState.timeoutAt as TimestampMs;
	} else if (toState.status === "awaiting_retry") {
		updates.nextAttemptAt = toState.nextAttemptAt as TimestampMs;
	}

	if (request.type === "optimistic") {
		const result = await txRepos.workflowRun.update(
			{
				id: runId,
				revision: request.expectedRevision,
			},
			updates
		);
		if (!result) {
			throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
		}
		return result.revision;
	} else {
		const result = await txRepos.workflowRun.update({ id: runId }, updates);
		if (!result) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		return result.revision;
	}
}

async function notifyParentOfStateChangeIfNecessary(
	context: NamespaceRequestContext,
	childRun: {
		id: string;
		latestStateTransitionId: string;
		parentWorkflowRunId: string;
		status: TerminalWorkflowRunStatus;
	},
	now: number,
	childRunCanceller: ChildRunCanceller,
	txRepos: TxRepos
): Promise<void> {
	const parentRun = await txRepos.workflowRun.getByIdWithState(context.namespaceId, childRun.parentWorkflowRunId);
	if (!parentRun) {
		throw new NotFoundError(`Workflow run not found: ${childRun.parentWorkflowRunId}`);
	}

	const parentRunState = parentRun.state;

	if (
		parentRunState.status === "awaiting_child_workflow" &&
		parentRunState.childWorkflowRunId === childRun.id &&
		parentRunState.childWorkflowRunStatus === childRun.status
	) {
		context.logger.info("Notifying parent of child state change", {
			"aiki.parentRunId": parentRun.id,
			"aiki.childRunId": childRun.id,
			"aiki.status": childRun.status,
		});

		await txRepos.childWorkflowRunWait.insert({
			id: ulid(),
			parentWorkflowRunId: parentRun.id,
			childWorkflowRunId: childRun.id,
			childWorkflowRunStatus: parentRunState.childWorkflowRunStatus,
			status: "completed",
			completedAt: now as TimestampMs,
			childWorkflowRunStateTransitionId: childRun.latestStateTransitionId,
		});

		await transitionStateInTx(
			context,
			{
				type: "optimistic",
				id: parentRun.id,
				state: { status: "scheduled", scheduledInMs: 0, reason: "child_workflow" },
				expectedRevision: parentRun.revision,
			},
			childRunCanceller,
			txRepos
		);
	}
}

export function convertDurationToTimestamp(request: WorkflowRunStateRequest, now: number): WorkflowRunState {
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
			childWorkflowRunStatus: request.childWorkflowRunStatus,
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
