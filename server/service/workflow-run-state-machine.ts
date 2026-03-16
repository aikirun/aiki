import { propsRequiredNonNull } from "@aikirun/lib/object";
import type {
	TerminalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateAwaitingChildWorkflow,
	WorkflowRunStateScheduled,
	WorkflowRunStatus,
	WorkflowStartOptions,
} from "@aikirun/types/workflow-run";
import { isTerminalWorkflowRunStatus } from "@aikirun/types/workflow-run";
import type {
	WorkflowRunStateRequest,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
} from "@aikirun/types/workflow-run-api";
import { InvalidWorkflowRunStateTransitionError, NotFoundError, WorkflowRunRevisionConflictError } from "server/errors";
import type { DatabaseConn, DbTransaction } from "server/infra/db";
import type { ChildWorkflowRunWaitQueueRepository } from "server/infra/db/repository/child-workflow-run-wait-queue";
import type { SleepQueueRepository } from "server/infra/db/repository/sleep-queue";
import type { StateTransitionRepository } from "server/infra/db/repository/state-transition";
import type { TaskRepository } from "server/infra/db/repository/task";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import type { NamespaceRequestContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";
import { ulid } from "ulidx";

type StateTransitionValidation = { allowed: true } | { allowed: false; reason?: string };

const workflowRunStateTransitionValidator: Record<
	WorkflowRunStatus,
	(to: WorkflowRunStateRequest) => StateTransitionValidation
> = {
	scheduled: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "queued", "paused", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new") {
				return { allowed: false, reason: "Only new run allowed" };
			}
			return { allowed: true };
		};
	})(),

	queued: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["running", "paused", "cancelled", "failed"];
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
	})(),

	running: (() => {
		const allowedDestinations: WorkflowRunStatus[] = [
			"scheduled",
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
			if (to.status === "scheduled" && to.reason !== "task_retry") {
				return { allowed: false, reason: "Only task retry run allowed" };
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
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "resume") {
				return { allowed: false, reason: "Only new or resume run allowed" };
			}
			return { allowed: true };
		};
	})(),

	sleeping: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "awake" && to.reason !== "awake_early") {
				return { allowed: false, reason: "Only new or awake run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_event: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "event") {
				return { allowed: false, reason: "Only new or event received run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_retry: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "retry") {
				return { allowed: false, reason: "Only new or retry run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_child_workflow: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "child_workflow") {
				return { allowed: false, reason: "Only new or child workflow triggered run allowed" };
			}
			return { allowed: true };
		};
	})(),

	cancelled: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new") {
				return { allowed: false, reason: "Only new run allowed" };
			}
			return { allowed: true };
		};
	})(),

	completed: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new") {
				return { allowed: false, reason: "Only new run allowed" };
			}
			return { allowed: true };
		};
	})(),

	failed: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "awaiting_retry"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new") {
				return { allowed: false, reason: "Only new run allowed" };
			}
			return { allowed: true };
		};
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

export interface WorkflowRunStateMachineServiceDeps {
	db: DatabaseConn;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
	sleepQueueRepo: SleepQueueRepository;
	taskRepo: TaskRepository;
	childWorkflowRunWaitQueueRepo: ChildWorkflowRunWaitQueueRepository;
	childRunCanceller: ChildRunCanceller;
}

export function createWorkflowRunStateMachineService(deps: WorkflowRunStateMachineServiceDeps) {
	async function transitionStateInTx(
		context: NamespaceRequestContext,
		request: WorkflowRunTransitionStateRequestV1,
		tx: DbTransaction
	): Promise<WorkflowRunTransitionStateResponseV1> {
		const namespaceId = context.namespaceId;
		const runId = request.id as WorkflowRunId;

		const run = await deps.workflowRunRepo.getByIdWithState(namespaceId, runId, tx, {
			forUpdate: request.type === "pessimistic",
		});
		if (!run) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		const fromState = run.state as WorkflowRunState;

		assertIsValidWorkflowRunStateTransition(runId, fromState, request.state);

		if (request.type === "optimistic" && run.revision !== request.expectedRevision) {
			throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
		}

		const now = Date.now();
		let toState = convertDurationsToTimestamps(request.state, now);

		context.logger.info({ runId, state: toState, attempts: run.attempts }, "Workflow state transition");

		if (fromState.status === "sleeping" && toState.status === "scheduled") {
			await finalizeSleep(runId, fromState.sleepName, toState, now, tx);
		}

		if (toState.status === "sleeping") {
			await deps.sleepQueueRepo.create(
				{
					id: ulid(),
					workflowRunId: runId,
					name: toState.sleepName,
					status: "sleeping",
					awakeAt: new Date(toState.awakeAt),
				},
				tx
			);
		}

		let attempts = run.attempts;
		if (
			toState.status === "running" &&
			fromState.status === "queued" &&
			(fromState.reason === "retry" || fromState.reason === "new")
		) {
			attempts++;
		}

		if (toState.status === "scheduled" && toState.reason === "retry") {
			await deps.taskRepo.deleteStaleByWorkflowRunIds(runId, tx);
		}

		if (toState.status === "awaiting_child_workflow") {
			if (await childWorkflowRunWaitNotNeeded(context, runId, toState, now, tx)) {
				toState = { status: "scheduled", scheduledAt: now, reason: "child_workflow" };
			}
		}

		const stateTransitionId = ulid();
		await deps.stateTransitionRepo.append(
			{
				id: stateTransitionId,
				workflowRunId: runId,
				type: "workflow_run",
				status: toState.status,
				attempt: attempts,
				state: toState,
			},
			tx
		);

		const newRevision = await updateWorkflowRun(runId, request, toState, stateTransitionId, attempts, tx);

		if (toState.status === "cancelled") {
			const shard = (run.options as WorkflowStartOptions | null)?.shard;
			await deps.childRunCanceller.cancel([{ namespaceId, runId, shard }], tx, context.logger);
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
				tx
			);
		}

		return { revision: newRevision, state: toState, attempts };
	}

	async function finalizeSleep(
		runId: WorkflowRunId,
		sleepName: string,
		toState: WorkflowRunStateScheduled,
		now: number,
		tx: DbTransaction
	) {
		const activeSleep = await deps.sleepQueueRepo.getActiveByWorkflowRunIdAndName(runId, sleepName, tx);
		if (!activeSleep) {
			return;
		}

		if (toState.reason === "awake") {
			await deps.sleepQueueRepo.update(
				activeSleep.id,
				{
					status: "completed",
					completedAt: new Date(now),
				},
				tx
			);
		} else {
			await deps.sleepQueueRepo.update(
				activeSleep.id,
				{
					status: "cancelled",
					cancelledAt: new Date(now),
				},
				tx
			);
		}
	}

	async function childWorkflowRunWaitNotNeeded(
		context: NamespaceRequestContext,
		runId: WorkflowRunId,
		toState: WorkflowRunStateAwaitingChildWorkflow,
		now: number,
		tx: DbTransaction
	) {
		const childRunId = toState.childWorkflowRunId as WorkflowRunId;
		const childRun = await deps.workflowRunRepo.getByIdWithState(context.namespaceId, childRunId, tx);
		if (!childRun) {
			throw new NotFoundError(`Workflow run not found: ${childRunId}`);
		}

		if (childRun.status === toState.childWorkflowRunStatus || isTerminalWorkflowRunStatus(childRun.status)) {
			await deps.childWorkflowRunWaitQueueRepo.insert(
				{
					id: ulid(),
					parentWorkflowRunId: runId,
					childWorkflowRunId: childRunId,
					childWorkflowRunStatus: toState.childWorkflowRunStatus,
					status: "completed",
					completedAt: new Date(now),
					childWorkflowRunStateTransitionId: childRun.latestStateTransitionId,
				},
				tx
			);

			context.logger.info(
				{ runId, childRunId, childRunStatus: childRun.status },
				"Child already at status, scheduling immediately"
			);

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
		tx: DbTransaction
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
			const result = await deps.workflowRunRepo.update(
				{
					id: runId,
					revision: request.expectedRevision,
				},
				updates,
				tx
			);
			if (!result) {
				throw new WorkflowRunRevisionConflictError(runId, request.expectedRevision);
			}
			return result.revision;
		} else {
			const result = await deps.workflowRunRepo.update({ id: runId }, updates, tx);
			if (!result) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}
			return result.revision;
		}
	}

	// TODO: should this be recursive?
	async function notifyParentOfStateChangeIfNecessary(
		context: NamespaceRequestContext,
		childRun: {
			id: string;
			latestStateTransitionId: string;
			parentWorkflowRunId: string;
			status: TerminalWorkflowRunStatus;
		},
		now: number,
		tx: DbTransaction
	): Promise<void> {
		const parentRun = await deps.workflowRunRepo.getByIdWithState(
			context.namespaceId,
			childRun.parentWorkflowRunId,
			tx
		);
		if (!parentRun) {
			throw new NotFoundError(`Workflow run not found: ${childRun.parentWorkflowRunId}`);
		}

		const parentRunState = parentRun.state as WorkflowRunState;

		if (
			parentRunState.status === "awaiting_child_workflow" &&
			parentRunState.childWorkflowRunId === childRun.id &&
			parentRunState.childWorkflowRunStatus === childRun.status
		) {
			context.logger.info(
				{ parentRunId: parentRun.id, childRunId: childRun.id, status: childRun.status },
				"Notifying parent of child state change"
			);

			await deps.childWorkflowRunWaitQueueRepo.insert(
				{
					id: ulid(),
					parentWorkflowRunId: parentRun.id,
					childWorkflowRunId: childRun.id,
					childWorkflowRunStatus: parentRunState.childWorkflowRunStatus,
					status: "completed",
					completedAt: new Date(now),
					childWorkflowRunStateTransitionId: childRun.latestStateTransitionId,
				},
				tx
			);

			await transitionStateInTx(
				context,
				{
					type: "optimistic",
					id: parentRun.id,
					state: { status: "scheduled", scheduledInMs: 0, reason: "child_workflow" },
					expectedRevision: parentRun.revision,
				},
				tx
			);
		}
	}

	return {
		transitionState: async (
			context: NamespaceRequestContext,
			request: WorkflowRunTransitionStateRequestV1,
			tx?: DbTransaction
		): Promise<WorkflowRunTransitionStateResponseV1> => {
			if (tx) {
				return transitionStateInTx(context, request, tx);
			}
			return deps.db.transaction(async (newTx) => transitionStateInTx(context, request, newTx));
		},
	};
}

export type WorkflowRunStateMachineService = ReturnType<typeof createWorkflowRunStateMachineService>;

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
