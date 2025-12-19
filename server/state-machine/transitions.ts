import type { TaskPath, TaskState, TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunId, WorkflowRunState, WorkflowRunStatus } from "@aikirun/types/workflow-run";
import { InvalidTaskStateTransitionError, InvalidWorkflowRunStateTransitionError } from "server/errors";

const validWorkflowRunStatusTransition: Record<WorkflowRunStatus, WorkflowRunStatus[]> = {
	scheduled: ["scheduled", "queued", "paused", "cancelled"],
	queued: ["running", "paused", "cancelled"],
	running: [
		"running",
		"paused",
		"sleeping",
		"awaiting_event",
		"awaiting_retry",
		"awaiting_child_workflow",
		"cancelled",
		"completed",
		"failed",
	],
	paused: ["scheduled", "cancelled"],
	sleeping: ["scheduled", "paused", "cancelled"],
	// biome-ignore lint/style/useNamingConvention:
	awaiting_event: ["scheduled", "paused", "cancelled"],
	// biome-ignore lint/style/useNamingConvention:
	awaiting_retry: ["scheduled", "paused", "cancelled"],
	// biome-ignore lint/style/useNamingConvention:
	awaiting_child_workflow: ["scheduled", "paused", "cancelled"],
	cancelled: ["scheduled"],
	completed: ["scheduled"],
	failed: ["scheduled"],
};

export function assertIsValidWorkflowRunStateTransition(
	runId: WorkflowRunId,
	from: WorkflowRunState<unknown>,
	to: WorkflowRunState<unknown>
) {
	const allowedDestinations = validWorkflowRunStatusTransition[from.status];
	if (!allowedDestinations.includes(to.status)) {
		throw new InvalidWorkflowRunStateTransitionError(runId, from.status, to.status);
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
