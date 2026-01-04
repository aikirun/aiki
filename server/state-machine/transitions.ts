// biome-ignore-all lint/style/useNamingConvention: snake case fields are okay
import type { TaskPath, TaskState, TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunId, WorkflowRunState, WorkflowRunStatus } from "@aikirun/types/workflow-run";
import type { TaskStateRequest, WorkflowRunStateRequest } from "@aikirun/types/workflow-run-api";
import { InvalidTaskStateTransitionError, InvalidWorkflowRunStateTransitionError } from "server/errors";

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
			if (to.status === "scheduled" && to.reason !== "new" && to.reason !== "awake") {
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

const validTaskStatusTransition: Record<TaskStatus, TaskStatus[]> = {
	running: ["running", "awaiting_retry", "completed", "failed"],
	awaiting_retry: ["running"],
	completed: [],
	failed: [],
};

export function assertIsValidTaskStateTransition(
	runId: WorkflowRunId,
	taskPath: TaskPath,
	from: TaskState | undefined,
	to: TaskStateRequest
) {
	if (!from) {
		if (to.status === "awaiting_retry") {
			throw new InvalidTaskStateTransitionError(runId, taskPath, undefined, to.status);
		}
		return;
	}

	const allowedDestinations = validTaskStatusTransition[from.status];
	if (!allowedDestinations.includes(to.status)) {
		throw new InvalidTaskStateTransitionError(runId, taskPath, from.status, to.status);
	}
}
