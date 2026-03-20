import type { ScheduleStatus } from "@aikirun/types/schedule";
import type { TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

export const WORKFLOW_RUN_STATUS_COLORS: Record<WorkflowRunStatus, { tint: string; text: string }> = {
	scheduled: { tint: "#A78BFA", text: "var(--accent-purple)" },
	queued: { tint: "#C084FC", text: "var(--accent-purple)" },
	running: { tint: "#38BDF8", text: "var(--accent-sky)" },
	paused: { tint: "#FBBF24", text: "var(--accent-amber)" },
	sleeping: { tint: "#818CF8", text: "var(--accent-indigo)" },
	awaiting_event: { tint: "#F472B6", text: "var(--accent-pink)" },
	awaiting_retry: { tint: "#FB923C", text: "var(--accent-orange)" },
	awaiting_child_workflow: { tint: "#C084FC", text: "var(--accent-purple)" },
	cancelled: { tint: "#6B7280", text: "var(--accent-gray)" },
	completed: { tint: "#34D399", text: "var(--accent-green)" },
	failed: { tint: "#F87171", text: "var(--accent-red)" },
};

export const TASK_STATUS_COLORS: Record<TaskStatus, { tint: string; text: string }> = {
	running: { tint: "#38BDF8", text: "var(--accent-sky)" },
	awaiting_retry: { tint: "#FB923C", text: "var(--accent-orange)" },
	completed: { tint: "#34D399", text: "var(--accent-green)" },
	failed: { tint: "#F87171", text: "var(--accent-red)" },
};

export const TASK_STATUS_GLYPHS: Record<TaskStatus, string> = {
	running: "●",
	awaiting_retry: "↺",
	completed: "✓",
	failed: "✕",
};

export const SCHEDULE_STATUS_COLORS: Record<ScheduleStatus, string> = {
	active: "#10B981",
	paused: "#F59E0B",
	deleted: "#6B7280",
};

export const API_KEY_STATUS_COLORS: Record<string, string> = {
	active: "#34D399",
	revoked: "#F87171",
	expired: "#6B7280",
};
