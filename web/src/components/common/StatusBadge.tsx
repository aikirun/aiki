import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

interface StatusBadgeProps {
	status: WorkflowRunStatus;
}

const statusConfig: Record<WorkflowRunStatus, { label: string; className: string; icon: string }> = {
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

const icons: Record<string, React.ReactNode> = {
	clock: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
	),
	queue: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
		</svg>
	),
	play: (
		<svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
			<circle cx="12" cy="12" r="10" className="animate-pulse" />
		</svg>
	),
	pause: (
		<svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
			<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
		</svg>
	),
	moon: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
			/>
		</svg>
	),
	signal: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
			/>
		</svg>
	),
	refresh: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
			/>
		</svg>
	),
	child: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
		</svg>
	),
	check: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
		</svg>
	),
	x: (
		<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
		</svg>
	),
};

export function StatusBadge({ status }: StatusBadgeProps) {
	const config = statusConfig[status];

	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.className}`}
		>
			{icons[config.icon]}
			{config.label}
		</span>
	);
}
