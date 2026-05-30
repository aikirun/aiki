import { NotFoundError } from "@aikirun/lib/error";
import { propsRequiredNonNull } from "@aikirun/lib/object";
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
	WorkflowRunStateScheduled,
	WorkflowRunStatus,
	WorkflowStartOptions,
} from "@aikirun/types/workflow/run";
import { isTerminalWorkflowRunStatus } from "@aikirun/types/workflow/run";
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
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
	})(),

	queued: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["running", "paused", "cancelled", "failed"];
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
			if (to.status === "scheduled" && to.reason !== "resume") {
				return { allowed: false, reason: "Only resume run allowed" };
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
			if (to.status === "scheduled" && to.reason !== "awake_early") {
				return { allowed: false, reason: "Only awake_early run allowed" };
			}
			if (to.status === "queued" && to.reason !== "awake") {
				return { allowed: false, reason: "Only awake run allowed" };
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
			if (to.status === "queued" && to.reason !== "event") {
				return { allowed: false, reason: "Only event received run allowed" };
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
			if (to.status === "queued" && to.reason !== "child_workflow") {
				return { allowed: false, reason: "Only child workflow triggered run allowed" };
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
	| "workflowRun"
	| "workflow"
	| "stateTransition"
	| "sleepQueue"
	| "task"
	| "childWorkflowRunWaitQueue"
	| "workflowRunOutbox"
>;

export interface WorkflowRunStateMachineServiceDeps {
	repos: TxRepos & Pick<Repositories, "transaction">;
	childRunCanceller: ChildRunCanceller;
}

export function createWorkflowRunStateMachineService(deps: WorkflowRunStateMachineServiceDeps) {
	const { repos, childRunCanceller } = deps;

	return {
		transitionState: async (
			context: NamespaceRequestContext,
			request: WorkflowRunTransitionStateRequestV1,
			txRepos?: TxRepos
		): Promise<WorkflowRunTransitionStateResponseV1> => {
			if (txRepos) {
				return transitionStateInTx(context, request, childRunCanceller, txRepos);
			}
			return repos.transaction(async (transactionRepos) =>
				transitionStateInTx(context, request, childRunCanceller, transactionRepos)
			);
		},
	};
}

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
	let toState = convertDurationsToTimestamps(request.state, now);

	context.logger.info("Workflow state transition", { runId, state: toState, attempts: run.attempts });

	if (fromState.status === "sleeping" && toState.status === "scheduled") {
		await finalizeSleep(runId, fromState.sleepName, toState, now, txRepos);
	}

	if (toState.status === "sleeping") {
		await txRepos.sleepQueue.create({
			id: ulid(),
			workflowRunId: runId,
			name: toState.sleepName,
			status: "sleeping",
			awakeAt: new Date(toState.awakeAt),
		});
	}

	let attempts = run.attempts;
	if (toState.status === "scheduled" || toState.status === "queued") {
		switch (toState.reason) {
			case "retry":
				// fromState guard prevents double-count across scheduled(retry) -> queued(retry).
				if (fromState.status !== "scheduled" && fromState.status !== "queued") {
					attempts++;
				}
				break;
			default:
				toState.reason satisfies "new" | "task_retry" | "awake" | "awake_early" | "resume" | "event" | "child_workflow";
		}
	}

	if (toState.status === "running") {
		await txRepos.workflowRunOutbox.markClaimed(namespaceId, runId);
	} else if (toState.status !== "queued") {
		await txRepos.workflowRunOutbox.deleteByWorkflowRunId(namespaceId, runId);
	}

	if (toState.status === "scheduled" && toState.reason === "retry") {
		await discardStaleTasks(runId, ["running", "awaiting_retry", "failed"], txRepos);
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
		const shard = (run.options as WorkflowStartOptions | null)?.shard;
		await childRunCanceller.cancel([{ namespaceId, runId, shard }], txRepos, context.logger);
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

async function finalizeSleep(
	runId: WorkflowRunId,
	sleepName: string,
	toState: WorkflowRunStateScheduled,
	now: number,
	txRepos: TxRepos
) {
	const activeSleep = await txRepos.sleepQueue.getActiveByWorkflowRunIdAndName(runId, sleepName);
	if (!activeSleep) {
		return;
	}

	if (toState.reason === "awake") {
		await txRepos.sleepQueue.update(activeSleep.id, {
			status: "completed",
			completedAt: new Date(now),
		});
	} else {
		await txRepos.sleepQueue.update(activeSleep.id, {
			status: "cancelled",
			cancelledAt: new Date(now),
		});
	}
}

async function childWorkflowRunWaitNotNeeded(
	context: NamespaceRequestContext,
	runId: WorkflowRunId,
	toState: WorkflowRunStateAwaitingChildWorkflow,
	now: number,
	txRepos: TxRepos
) {
	const childRunId = toState.childWorkflowRunId as WorkflowRunId;
	const childRun = await txRepos.workflowRun.getByIdWithState(context.namespaceId, childRunId);
	if (!childRun) {
		throw new NotFoundError(`Workflow run not found: ${childRunId}`);
	}

	if (childRun.status === toState.childWorkflowRunStatus || isTerminalWorkflowRunStatus(childRun.status)) {
		await txRepos.childWorkflowRunWaitQueue.insert({
			id: ulid(),
			parentWorkflowRunId: runId,
			childWorkflowRunId: childRunId,
			childWorkflowRunStatus: toState.childWorkflowRunStatus,
			status: "completed",
			completedAt: new Date(now),
			childWorkflowRunStateTransitionId: childRun.latestStateTransitionId,
		});

		context.logger.info("Child already at status, scheduling immediately", {
			runId,
			childRunId,
			childRunStatus: childRun.status,
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
		awakeAt: null,
		timeoutAt: null,
		nextAttemptAt: null,
	};
	if (toState.status === "scheduled") {
		updates.scheduledAt = new Date(toState.scheduledAt);
	} else if (toState.status === "sleeping") {
		updates.awakeAt = new Date(toState.awakeAt);
	} else if (
		(toState.status === "awaiting_event" || toState.status === "awaiting_child_workflow") &&
		toState.timeoutAt !== undefined
	) {
		updates.timeoutAt = new Date(toState.timeoutAt);
	} else if (toState.status === "awaiting_retry") {
		updates.nextAttemptAt = new Date(toState.nextAttemptAt);
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
			parentRunId: parentRun.id,
			childRunId: childRun.id,
			status: childRun.status,
		});

		await txRepos.childWorkflowRunWaitQueue.insert({
			id: ulid(),
			parentWorkflowRunId: parentRun.id,
			childWorkflowRunId: childRun.id,
			childWorkflowRunStatus: parentRunState.childWorkflowRunStatus,
			status: "completed",
			completedAt: new Date(now),
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

function convertDurationsToTimestamps(request: WorkflowRunStateRequest, now: number): WorkflowRunState {
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
			awakeAt: now + request.durationMs,
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
