import type { ScheduleStatus } from "@aikirun/types/schedule";
import type { WorkflowRunStatus } from "@aikirun/types/workflow/run";
import type { TaskStatus } from "@aikirun/types/workflow/task";

/**
 * Status colours are CSS custom properties, so a status keeps its meaning across
 * themes while the actual hue is tuned per theme in index.css.
 *
 * `tint` fills a chip, `edge` draws its border. Both are mixed from the same
 * colour, by an amount the theme decides (`--tint-mix` / `--edge-mix`).
 */
export function tint(color: string): string {
	return `color-mix(in srgb, ${color} var(--tint-mix), transparent)`;
}

export function edge(color: string): string {
	return `color-mix(in srgb, ${color} var(--edge-mix), transparent)`;
}

export const WORKFLOW_RUN_STATUS_COLORS: Record<WorkflowRunStatus, string> = {
	scheduled: "var(--accent-indigo)",
	queued: "var(--accent-purple)",
	running: "var(--accent-sky)",
	paused: "var(--accent-amber)",
	sleeping: "var(--accent-indigo)",
	awaiting_event: "var(--accent-pink)",
	awaiting_retry: "var(--accent-orange)",
	awaiting_task_retry: "var(--accent-orange)",
	awaiting_child_workflow: "var(--accent-purple)",
	stalled: "var(--accent-gray)",
	cancelled: "var(--accent-gray)",
	completed: "var(--accent-green)",
	failed: "var(--accent-red)",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
	running: "var(--accent-sky)",
	awaiting_retry: "var(--accent-orange)",
	completed: "var(--accent-green)",
	failed: "var(--accent-red)",
	discarded: "var(--accent-gray)",
};

export const TASK_STATUS_GLYPHS: Record<TaskStatus, string> = {
	running: "●",
	awaiting_retry: "↺",
	completed: "✓",
	failed: "✕",
	discarded: "⊘",
};

export const SCHEDULE_STATUS_COLORS: Record<ScheduleStatus, string> = {
	active: "var(--accent-green)",
	paused: "var(--accent-amber)",
	inactive: "var(--accent-gray)",
};

export const API_KEY_STATUS_COLORS: Record<string, string> = {
	active: "var(--accent-green)",
	revoked: "var(--accent-red)",
	expired: "var(--accent-gray)",
};
