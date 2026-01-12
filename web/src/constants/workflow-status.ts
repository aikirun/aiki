import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

export const WORKFLOW_STATUS_CONFIG: Record<WorkflowRunStatus, { label: string; className: string; icon: string }> = {
	scheduled: {
		label: "Scheduled",
		className: "bg-slate-100 text-slate-700 border-slate-300",
		icon: "clock",
	},
	queued: {
		label: "Queued",
		className: "bg-slate-100 text-slate-700 border-slate-300",
		icon: "queue",
	},
	running: {
		label: "Running",
		className: "bg-blue-100 text-blue-700 border-blue-300",
		icon: "play",
	},
	paused: {
		label: "Paused",
		className: "bg-amber-100 text-amber-700 border-amber-300",
		icon: "pause",
	},
	sleeping: {
		label: "Sleeping",
		className: "bg-purple-100 text-purple-700 border-purple-300",
		icon: "moon",
	},
	awaiting_event: {
		label: "Awaiting Event",
		className: "bg-indigo-100 text-indigo-700 border-indigo-300",
		icon: "signal",
	},
	awaiting_retry: {
		label: "Awaiting Retry",
		className: "bg-orange-100 text-orange-700 border-orange-300",
		icon: "refresh",
	},
	awaiting_child_workflow: {
		label: "Awaiting Child",
		className: "bg-cyan-100 text-cyan-700 border-cyan-300",
		icon: "child",
	},
	cancelled: {
		label: "Cancelled",
		className: "bg-slate-100 text-slate-600 border-slate-300",
		icon: "x",
	},
	completed: {
		label: "Completed",
		className: "bg-emerald-100 text-emerald-700 border-emerald-300",
		icon: "check",
	},
	failed: {
		label: "Failed",
		className: "bg-red-100 text-red-700 border-red-300",
		icon: "x",
	},
};

export type StatusOption = { value: WorkflowRunStatus; label: string };

export const STATUS_OPTIONS: StatusOption[] = Object.entries(WORKFLOW_STATUS_CONFIG).map(([value, { label }]) => ({
	value: value as WorkflowRunStatus,
	label,
}));
