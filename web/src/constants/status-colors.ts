import type { ScheduleStatus } from "@aikirun/types/schedule";
import type { TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

export const WORKFLOW_RUN_STATUS_COLORS: Record<WorkflowRunStatus, string> = {
	scheduled: "#A78BFA",
	queued: "#C084FC",
	running: "#38BDF8",
	paused: "#FBBF24",
	sleeping: "#818CF8",
	awaiting_event: "#F472B6",
	awaiting_retry: "#FB923C",
	awaiting_child_workflow: "#C084FC",
	cancelled: "#6B7280",
	completed: "#34D399",
	failed: "#F87171",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
	running: "#38BDF8",
	awaiting_retry: "#FB923C",
	completed: "#34D399",
	failed: "#F87171",
};

export const TASK_STATUS_GLYPHS: Record<TaskStatus, string> = {
	running: "●",
	awaiting_retry: "↺",
	completed: "✓",
	failed: "✕",
};

export const SCHEDULE_STATUS_COLORS: Record<ScheduleStatus, string> = {
	active: "#34D399",
	paused: "#FBBF24",
	deleted: "#6B7280",
};

export const API_KEY_STATUS_COLORS: Record<string, string> = {
	active: "#34D399",
	revoked: "#F87171",
	expired: "#6B7280",
};
