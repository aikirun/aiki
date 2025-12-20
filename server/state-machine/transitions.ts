// biome-ignore-all lint/style/useNamingConvention: snake case fields are okay
import type { TaskPath, TaskState, TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunId, WorkflowRunState, WorkflowRunStatus } from "@aikirun/types/workflow-run";
import { InvalidTaskStateTransitionError, InvalidWorkflowRunStateTransitionError } from "server/errors";

type StateTransitionValidation = { allowed: true } | { allowed: false; reason?: string };

const workflowRunStateTransitionValidator: Record<
	WorkflowRunStatus,
	(to: WorkflowRunState<unknown>) => StateTransitionValidation
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
		const allowedDestinations: WorkflowRunStatus[] = ["running", "paused", "cancelled"];
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
	})(),

	running: (() => {
		const allowedDestinations: WorkflowRunStatus[] = [
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
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
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
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "paused", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "awake" && to.reason !== "resume") {
				return { allowed: false, reason: "Only new or awake or resume run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_event: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "paused", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "event") {
				return { allowed: false, reason: "Only new or event run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_retry: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "paused", "cancelled"];
		return (to) => {
			if (!allowedDestinations.includes(to.status)) {
				return { allowed: false };
			}
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "retry") {
				return { allowed: false, reason: "Only new or event run allowed" };
			}
			return { allowed: true };
		};
	})(),

	awaiting_child_workflow: (() => {
		const allowedDestinations: WorkflowRunStatus[] = ["scheduled", "paused", "cancelled"];
		// TODO: possibly add a new scheduled reason for when child workflows complete and the parent needs to resume
		return (to) => ({ allowed: allowedDestinations.includes(to.status) });
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
	from: WorkflowRunState<unknown>,
	to: WorkflowRunState<unknown>
) {
	const result = workflowRunStateTransitionValidator[from.status](to);
	if (!result.allowed) {
		throw new InvalidWorkflowRunStateTransitionError(runId, from.status, to.status, result.reason);
	}
}

const validTaskStatusTransition: Record<TaskStatus, TaskStatus[]> = {
	none: ["running", "completed"],
	running: ["none", "running", "completed", "failed"],
	completed: ["none"],
	failed: ["none"],
};

export function assertIsValidTaskStateTransition(
	runId: WorkflowRunId,
	taskPath: TaskPath,
	from: TaskState<unknown>,
	to: TaskState<unknown>
) {
	const allowedDestinations = validTaskStatusTransition[from.status];
	if (!allowedDestinations.includes(to.status)) {
		throw new InvalidTaskStateTransitionError(runId, taskPath, from.status, to.status);
	}
}
