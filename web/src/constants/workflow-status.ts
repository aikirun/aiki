import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

import { WORKFLOW_RUN_STATUS_COLORS } from "./status-colors";

export const WORKFLOW_STATUS_CONFIG: Record<
	WorkflowRunStatus,
	{ label: string; color: string; glyph: string; live?: boolean }
> = {
	scheduled: {
		label: "Scheduled",
		color: WORKFLOW_RUN_STATUS_COLORS.scheduled,
		glyph: "◈",
	},
	queued: {
		label: "Queued",
		color: WORKFLOW_RUN_STATUS_COLORS.queued,
		glyph: "◇",
	},
	running: {
		label: "Running",
		color: WORKFLOW_RUN_STATUS_COLORS.running,
		glyph: "●",
		live: true,
	},
	paused: {
		label: "Paused",
		color: WORKFLOW_RUN_STATUS_COLORS.paused,
		glyph: "❙❙",
	},
	sleeping: {
		label: "Sleeping",
		color: WORKFLOW_RUN_STATUS_COLORS.sleeping,
		glyph: "☽",
	},
	awaiting_event: {
		label: "Awaiting Event",
		color: WORKFLOW_RUN_STATUS_COLORS.awaiting_event,
		glyph: "⚡",
	},
	awaiting_retry: {
		label: "Awaiting Retry",
		color: WORKFLOW_RUN_STATUS_COLORS.awaiting_retry,
		glyph: "↺",
	},
	awaiting_child_workflow: {
		label: "Awaiting Child",
		color: WORKFLOW_RUN_STATUS_COLORS.awaiting_child_workflow,
		glyph: "⑂",
	},
	cancelled: {
		label: "Cancelled",
		color: WORKFLOW_RUN_STATUS_COLORS.cancelled,
		glyph: "⊘",
	},
	completed: {
		label: "Completed",
		color: WORKFLOW_RUN_STATUS_COLORS.completed,
		glyph: "✓",
	},
	failed: {
		label: "Failed",
		color: WORKFLOW_RUN_STATUS_COLORS.failed,
		glyph: "✕",
	},
};

export type StatusOption = { value: WorkflowRunStatus; label: string };

export const STATUS_OPTIONS: StatusOption[] = Object.entries(WORKFLOW_STATUS_CONFIG).map(([value, { label }]) => ({
	value: value as WorkflowRunStatus,
	label,
}));
