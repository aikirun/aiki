import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

import { WORKFLOW_RUN_STATUS_COLORS } from "./status-colors";

export const WORKFLOW_STATUS_CONFIG: Record<
	WorkflowRunStatus,
	{ label: string; color: string; textColor: string; glyph: string; live?: boolean }
> = {
	scheduled: {
		label: "Scheduled",
		color: WORKFLOW_RUN_STATUS_COLORS.scheduled.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.scheduled.text,
		glyph: "◈",
	},
	queued: {
		label: "Queued",
		color: WORKFLOW_RUN_STATUS_COLORS.queued.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.queued.text,
		glyph: "◇",
	},
	running: {
		label: "Running",
		color: WORKFLOW_RUN_STATUS_COLORS.running.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.running.text,
		glyph: "●",
		live: true,
	},
	paused: {
		label: "Paused",
		color: WORKFLOW_RUN_STATUS_COLORS.paused.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.paused.text,
		glyph: "❙❙",
	},
	sleeping: {
		label: "Sleeping",
		color: WORKFLOW_RUN_STATUS_COLORS.sleeping.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.sleeping.text,
		glyph: "☽",
	},
	awaiting_event: {
		label: "Awaiting Event",
		color: WORKFLOW_RUN_STATUS_COLORS.awaiting_event.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.awaiting_event.text,
		glyph: "⚡",
	},
	awaiting_retry: {
		label: "Awaiting Retry",
		color: WORKFLOW_RUN_STATUS_COLORS.awaiting_retry.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.awaiting_retry.text,
		glyph: "↺",
	},
	awaiting_child_workflow: {
		label: "Awaiting Child",
		color: WORKFLOW_RUN_STATUS_COLORS.awaiting_child_workflow.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.awaiting_child_workflow.text,
		glyph: "⑂",
	},
	cancelled: {
		label: "Cancelled",
		color: WORKFLOW_RUN_STATUS_COLORS.cancelled.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.cancelled.text,
		glyph: "⊘",
	},
	completed: {
		label: "Completed",
		color: WORKFLOW_RUN_STATUS_COLORS.completed.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.completed.text,
		glyph: "✓",
	},
	failed: {
		label: "Failed",
		color: WORKFLOW_RUN_STATUS_COLORS.failed.tint,
		textColor: WORKFLOW_RUN_STATUS_COLORS.failed.text,
		glyph: "✕",
	},
};

export type StatusOption = { value: WorkflowRunStatus; label: string };

export const STATUS_OPTIONS: StatusOption[] = Object.entries(WORKFLOW_STATUS_CONFIG).map(([value, { label }]) => ({
	value: value as WorkflowRunStatus,
	label,
}));
