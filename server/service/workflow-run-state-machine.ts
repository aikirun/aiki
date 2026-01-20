import { propsDefined, type RequiredProp } from "@aikirun/lib";
import { isNonEmptyArray } from "@aikirun/lib/array";
import {
	isTerminalWorkflowRunStatus,
	type WorkflowRun,
	type WorkflowRunId,
	type WorkflowRunState,
	type WorkflowRunStatus,
	type WorkflowRunTransition,
} from "@aikirun/types/workflow-run";
import type {
	WorkflowRunStateRequest,
	WorkflowRunTransitionStateRequestV1,
	WorkflowRunTransitionStateResponseV1,
} from "@aikirun/types/workflow-run-api";
import { InvalidWorkflowRunStateTransitionError, NotFoundError, RevisionConflictError } from "server/errors";
import { workflowRunsById, workflowRunTransitionsById } from "server/infra/db/in-memory-store";
import type { Context } from "server/middleware/context";

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

export async function transitionWorkflowRunState(
	context: Context,
	request: WorkflowRunTransitionStateRequestV1
): Promise<WorkflowRunTransitionStateResponseV1> {
	const runId = request.id as WorkflowRunId;

	const run = workflowRunsById.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (request.type === "optimistic" && run.revision !== request.expectedRevision) {
		throw new RevisionConflictError(runId, request.expectedRevision, run.revision);
	}

	assertIsValidWorkflowRunStateTransition(runId, run.state, request.state);

	const now = Date.now();
	let state = convertWorkflowRunStateDurationsToTimestamps(request.state, now);

	context.logger.info({ runId, state, attempts: run.attempts }, "Workflow state transition");

	const transitions = workflowRunTransitionsById.get(runId) ?? [];

	if (run.state.status === "sleeping" && state.status === "scheduled") {
		const sleepQueue = run.sleepsQueue[run.state.sleepName];
		if (sleepQueue && isNonEmptyArray(sleepQueue.sleeps)) {
			if (state.reason === "awake") {
				// biome-ignore lint/style/noNonNullAssertion: there must have been a previous transition into sleeping
				const startedSleepingAt = transitions[transitions.length - 1]!.createdAt;
				sleepQueue.sleeps[sleepQueue.sleeps.length - 1] = {
					status: "completed",
					durationMs: now - startedSleepingAt,
					completedAt: now,
				};
			} else {
				sleepQueue.sleeps[sleepQueue.sleeps.length - 1] = {
					status: "cancelled",
					cancelledAt: now,
				};
			}
		}
	}

	if (state.status === "sleeping") {
		const { sleepName, awakeAt } = state;
		const sleepQueue = run.sleepsQueue[sleepName];
		if (sleepQueue?.sleeps) {
			sleepQueue.sleeps.push({ status: "sleeping", awakeAt });
		} else {
			run.sleepsQueue[sleepName] = {
				sleeps: [{ status: "sleeping", awakeAt }],
			};
		}
	}

	if (
		state.status === "running" &&
		run.state.status === "queued" &&
		(run.state.reason === "retry" || run.state.reason === "new")
	) {
		run.attempts++;
	}

	if (state.status === "scheduled" && state.reason === "retry") {
		for (const [taskAddress, taskInfo] of Object.entries(run.tasks)) {
			if (
				taskInfo.state.status === "running" ||
				taskInfo.state.status === "awaiting_retry" ||
				taskInfo.state.status === "failed"
			) {
				delete run.tasks[taskAddress];
			} else {
				taskInfo.state.status satisfies "completed";
			}
		}
	}

	if (state.status === "awaiting_child_workflow") {
		const childRunId = state.childWorkflowRunId as WorkflowRunId;
		const childRun = workflowRunsById.get(childRunId);
		if (childRun) {
			const childRunStatus = childRun.state.status;
			const expectedStatus = state.childWorkflowRunStatus;

			if (childRunStatus === expectedStatus || isTerminalWorkflowRunStatus(childRunStatus)) {
				const statusWaitResults = run.childWorkflowRuns[childRun.address]?.statusWaitResults;
				if (statusWaitResults) {
					statusWaitResults.push({
						status: "completed",
						completedAt: now,
						childWorkflowRunState: childRun.state,
					});
				}

				state = { status: "scheduled", scheduledAt: now, reason: "child_workflow" };
				context.logger.info({ runId, childRunId, childRunStatus }, "Child already at status, scheduling immediately");
			}
		}
	}

	const transition: WorkflowRunTransition = {
		id: crypto.randomUUID(),
		type: "state",
		createdAt: now,
		state,
	};
	if (!transitions.length) {
		transitions.push(transition);
		workflowRunTransitionsById.set(runId, transitions);
	} else {
		transitions.push(transition);
	}

	run.state = state;
	run.revision++;

	if (state.status === "cancelled") {
		for (const [childRunAddress, childRunInfo] of Object.entries(run.childWorkflowRuns)) {
			const childRun = workflowRunsById.get(childRunInfo.id as WorkflowRunId);
			if (!childRun) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}
			await transitionWorkflowRunState(context, {
				type: "pessimistic",
				id: childRunInfo.id,
				state: {
					status: "cancelled",
					reason: "Parent cancelled",
				},
			});
			run.childWorkflowRuns[childRunAddress] = {
				id: childRunInfo.id,
				name: childRunInfo.name,
				versionId: childRunInfo.versionId,
				inputHash: childRunInfo.inputHash,
				statusWaitResults: [],
			};
		}
	}

	if (propsDefined(run, "parentWorkflowRunId")) {
		await notifyParentOfStateChangeIfNecessary(context, run);
	}

	return { run };
}

async function notifyParentOfStateChangeIfNecessary(
	context: Context,
	childRun: RequiredProp<WorkflowRun, "parentWorkflowRunId">
): Promise<void> {
	const parentRun = workflowRunsById.get(childRun.parentWorkflowRunId as WorkflowRunId);
	if (!parentRun) {
		return;
	}

	if (
		parentRun.state.status === "awaiting_child_workflow" &&
		parentRun.state.childWorkflowRunId === childRun.id &&
		parentRun.state.childWorkflowRunStatus === childRun.state.status
	) {
		context.logger.info(
			{ parentRunId: parentRun.id, childRunId: childRun.id, status: childRun.state.status },
			"Notifying parent of child state change"
		);

		const statusWaitResults = parentRun.childWorkflowRuns[childRun.address]?.statusWaitResults;
		if (statusWaitResults) {
			statusWaitResults.push({
				status: "completed",
				completedAt: Date.now(),
				childWorkflowRunState: childRun.state,
			});
		}

		await transitionWorkflowRunState(context, {
			type: "optimistic",
			id: parentRun.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "child_workflow" },
			expectedRevision: parentRun.revision,
		});
	}
}

function convertWorkflowRunStateDurationsToTimestamps(request: WorkflowRunStateRequest, now: number): WorkflowRunState {
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
