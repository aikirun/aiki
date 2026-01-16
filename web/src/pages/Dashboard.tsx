import type { Schedule, ScheduleSpec, ScheduleStatus } from "@aikirun/types/schedule";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { client } from "../api/client";
import { useSchedules, useWorkflowStats, useWorkflows } from "../api/hooks";
import { CopyButton } from "../components/common/CopyButton";
import { EmptyState } from "../components/common/EmptyState";
import { MultiSelectDropdown } from "../components/common/MultiSelectDropdown";
import { RelativeTime } from "../components/common/RelativeTime";
import { TableSkeleton } from "../components/common/TableSkeleton";
import { StatCard } from "../components/stats/StatCard";
import {
	SCHEDULE_STATUS_CONFIG,
	SCHEDULE_STATUS_OPTIONS,
	type ScheduleStatusOption,
} from "../constants/schedule-status";
import { useDebounce } from "../hooks/useDebounce";

type Tab = "workflows" | "schedules";

const DEFAULT_SCHEDULE_STATUSES = ["active", "paused"] as const;

export function Dashboard() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { data: stats, isLoading: statsLoading } = useWorkflowStats();

	const tabParam = searchParams.get("tab");
	const activeTab: Tab = tabParam === "schedules" ? "schedules" : "workflows";

	const setActiveTab = useCallback(
		(tab: Tab) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				if (tab === "workflows") {
					next.delete("tab");
				} else {
					next.set("tab", tab);
				}
				return next;
			});
		},
		[setSearchParams]
	);

	const statusParam = searchParams.get("status");
	const selectedStatuses =
		statusParam === "none"
			? []
			: statusParam
				? SCHEDULE_STATUS_OPTIONS.filter((o) => statusParam.split(",").filter(Boolean).includes(o.value))
				: SCHEDULE_STATUS_OPTIONS.filter((o) =>
						DEFAULT_SCHEDULE_STATUSES.includes(o.value as (typeof DEFAULT_SCHEDULE_STATUSES)[number])
					);

	const setSelectedStatuses = useCallback(
		(statuses: ScheduleStatusOption[]) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);

				if (statuses.length === 0) {
					next.set("status", "none");
				} else {
					const selectedValues = new Set(statuses.map((s) => s.value));
					const isDefault =
						selectedValues.size === DEFAULT_SCHEDULE_STATUSES.length &&
						DEFAULT_SCHEDULE_STATUSES.every((v) => selectedValues.has(v));

					if (isDefault) {
						next.delete("status");
					} else {
						next.set("status", statuses.map((s) => s.value).join(","));
					}
				}
				return next;
			});
		},
		[setSearchParams]
	);

	const [idFilter, setIdFilter] = useState(searchParams.get("id") || "");
	const [referenceIdFilter, setReferenceIdFilter] = useState(searchParams.get("refId") || "");
	const [workflowFilter, setWorkflowFilter] = useState(searchParams.get("workflow") || "");

	useEffect(() => {
		const urlId = searchParams.get("id") || "";
		const urlRefId = searchParams.get("refId") || "";
		const urlWorkflow = searchParams.get("workflow") || "";
		setIdFilter(urlId);
		setReferenceIdFilter(urlRefId);
		setWorkflowFilter(urlWorkflow);
	}, [searchParams]);

	const debouncedId = useDebounce(idFilter, 500);
	const debouncedRefId = useDebounce(referenceIdFilter, 500);
	const debouncedWorkflow = useDebounce(workflowFilter, 500);

	useEffect(() => {
		const currentId = searchParams.get("id") || "";
		const currentRefId = searchParams.get("refId") || "";
		const currentWorkflow = searchParams.get("workflow") || "";

		if (debouncedId !== currentId || debouncedRefId !== currentRefId || debouncedWorkflow !== currentWorkflow) {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				if (debouncedId) {
					next.set("id", debouncedId);
				} else {
					next.delete("id");
				}
				if (debouncedRefId) {
					next.set("refId", debouncedRefId);
				} else {
					next.delete("refId");
				}
				if (debouncedWorkflow) {
					next.set("workflow", debouncedWorkflow);
				} else {
					next.delete("workflow");
				}
				return next;
			});
		}
	}, [debouncedId, debouncedRefId, debouncedWorkflow, searchParams, setSearchParams]);

	return (
		<div className="space-y-8">
			{/* Stats Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
				{statsLoading ? (
					<>
						<StatCardSkeleton />
						<StatCardSkeleton />
						<StatCardSkeleton />
						<StatCardSkeleton />
					</>
				) : stats ? (
					<>
						<StatCard
							label="Running"
							value={stats.stats.runsByStatus.running + stats.stats.runsByStatus.queued}
							color="blue"
							icon="running"
						/>
						<StatCard label="Completed" value={stats.stats.runsByStatus.completed} color="green" icon="completed" />
						<StatCard label="Failed" value={stats.stats.runsByStatus.failed} color="red" icon="failed" />
						<StatCard label="Sleeping" value={stats.stats.runsByStatus.sleeping} color="yellow" icon="sleeping" />
					</>
				) : null}
			</div>

			{/* Tabbed Content */}
			<div className="bg-white rounded-2xl border-2 border-slate-200">
				{/* Tab Buttons */}
				<div className="flex border-b border-slate-200">
					<button
						type="button"
						onClick={() => setActiveTab("workflows")}
						className={`px-6 py-4 font-medium transition-colors ${
							activeTab === "workflows"
								? "text-aiki-purple border-b-2 border-aiki-purple -mb-px"
								: "text-slate-500 hover:text-slate-700"
						}`}
					>
						Workflows
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("schedules")}
						className={`px-6 py-4 font-medium transition-colors ${
							activeTab === "schedules"
								? "text-aiki-purple border-b-2 border-aiki-purple -mb-px"
								: "text-slate-500 hover:text-slate-700"
						}`}
					>
						Schedules
					</button>
					{activeTab === "schedules" && (
						<div className="ml-auto flex items-center gap-3 pr-4">
							<input
								type="text"
								placeholder="ID..."
								value={idFilter}
								onChange={(e) => setIdFilter(e.target.value)}
								className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-aiki-purple/20 focus:border-aiki-purple w-40"
							/>
							<input
								type="text"
								placeholder="Reference ID..."
								value={referenceIdFilter}
								onChange={(e) => setReferenceIdFilter(e.target.value)}
								className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-aiki-purple/20 focus:border-aiki-purple w-40"
							/>
							<input
								type="text"
								placeholder="Workflow..."
								value={workflowFilter}
								onChange={(e) => setWorkflowFilter(e.target.value)}
								className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-aiki-purple/20 focus:border-aiki-purple w-40"
							/>
							<MultiSelectDropdown
								label="Status"
								options={SCHEDULE_STATUS_OPTIONS}
								selected={selectedStatuses}
								onChange={setSelectedStatuses}
								getOptionValue={(o) => o.value}
								getOptionLabel={(o) => o.label}
							/>
						</div>
					)}
				</div>

				{/* Tab Content */}
				{activeTab === "workflows" ? (
					<WorkflowsTab />
				) : (
					<SchedulesTab
						selectedStatuses={selectedStatuses}
						idFilter={debouncedId}
						referenceIdFilter={debouncedRefId}
						workflowFilter={debouncedWorkflow}
					/>
				)}
			</div>
		</div>
	);
}

function WorkflowsTab() {
	const { data: workflows, isLoading } = useWorkflows({
		sort: { field: "name", order: "asc" },
	});

	if (isLoading) {
		return (
			<div className="p-6">
				<TableSkeleton rows={3} columns={3} />
			</div>
		);
	}

	if (workflows?.workflows.length === 0) {
		return <EmptyState title="No workflows yet" description="Workflows will appear here when runs are created" />;
	}

	return (
		<table className="w-full">
			<thead>
				<tr className="border-b border-slate-100">
					<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
					<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Runs</th>
					<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
						Last Run
					</th>
				</tr>
			</thead>
			<tbody className="divide-y divide-slate-100">
				{workflows?.workflows.map((workflow) => (
					<tr key={workflow.name} className="hover:bg-slate-50 transition-colors">
						<td className="px-6 py-4">
							<Link
								to={`/workflow/${encodeURIComponent(workflow.name)}`}
								className="font-semibold text-slate-900 hover:text-aiki-purple transition-colors"
							>
								{workflow.name}
							</Link>
						</td>
						<td className="px-6 py-4 text-right text-slate-600">{workflow.runCount.toLocaleString()}</td>
						<td className="px-6 py-4 text-right text-slate-500">
							{workflow.lastRunAt ? <RelativeTime timestamp={workflow.lastRunAt} /> : "—"}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function SchedulesTab({
	selectedStatuses,
	idFilter,
	referenceIdFilter,
	workflowFilter,
}: {
	selectedStatuses: ScheduleStatusOption[];
	idFilter: string;
	referenceIdFilter: string;
	workflowFilter: string;
}) {
	const isAllSelected = selectedStatuses.length === SCHEDULE_STATUS_OPTIONS.length;
	const statusFilters =
		!isAllSelected && selectedStatuses.length > 0 ? selectedStatuses.map((s) => s.value) : undefined;

	const filters: { status?: ScheduleStatus[]; id?: string; referenceId?: string; workflows?: { name: string }[] } = {};
	if (statusFilters) filters.status = statusFilters;
	if (idFilter) filters.id = idFilter;
	if (referenceIdFilter) filters.referenceId = referenceIdFilter;
	if (workflowFilter) filters.workflows = [{ name: workflowFilter }];

	const hasFilters = Object.keys(filters).length > 0;

	const { data, isLoading } = useSchedules({
		filters: hasFilters ? filters : undefined,
	});

	return (
		<>
			{isLoading ? (
				<div className="p-6">
					<TableSkeleton rows={5} columns={7} />
				</div>
			) : data?.schedules.length === 0 ? (
				<EmptyState
					title="No schedules found"
					description={hasFilters ? "Try adjusting your filters" : "Activate a schedule to see it here"}
				/>
			) : (
				<table className="w-full">
					<thead>
						<tr className="border-b border-slate-100">
							<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ID</th>
							<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
								Reference ID
							</th>
							<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
								Workflow
							</th>
							<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
								Schedule
							</th>
							<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
								Status
							</th>
							<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
								Next Run
							</th>
							<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
								Runs
							</th>
							<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
								Actions
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{data?.schedules.map((schedule) => (
							<ScheduleRow key={schedule.id} schedule={schedule} />
						))}
					</tbody>
				</table>
			)}
		</>
	);
}

function ScheduleRow({ schedule }: { schedule: Schedule }) {
	const queryClient = useQueryClient();
	const [isActioning, setIsActioning] = useState(false);

	const handlePause = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsActioning(true);
		try {
			await client.schedule.pauseV1({ id: schedule.id });
			queryClient.invalidateQueries({ queryKey: ["schedules"] });
		} finally {
			setIsActioning(false);
		}
	};

	const handleResume = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsActioning(true);
		try {
			await client.schedule.resumeV1({ id: schedule.id });
			queryClient.invalidateQueries({ queryKey: ["schedules"] });
		} finally {
			setIsActioning(false);
		}
	};

	const handleDelete = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsActioning(true);
		try {
			await client.schedule.deleteV1({ id: schedule.id });
			queryClient.invalidateQueries({ queryKey: ["schedules"] });
		} finally {
			setIsActioning(false);
		}
	};

	const canPause = schedule.status === "active";
	const canResume = schedule.status === "paused";
	const canDelete = schedule.status !== "deleted";

	const referenceId = schedule.options?.reference?.id;

	return (
		<tr className="hover:bg-slate-50 transition-colors">
			<td className="px-6 py-4 font-mono text-sm text-slate-600">
				<div className="flex items-center gap-1">
					<span className="max-w-[120px] truncate" title={schedule.id}>
						{schedule.id}
					</span>
					<CopyButton text={schedule.id} title="Copy Schedule ID" />
				</div>
			</td>
			<td className="px-6 py-4 font-mono text-sm text-slate-600">
				{referenceId ? (
					<div className="flex items-center gap-1">
						<span className="max-w-[120px] truncate" title={referenceId}>
							{referenceId}
						</span>
						<CopyButton text={referenceId} title="Copy Reference ID" />
					</div>
				) : (
					"—"
				)}
			</td>
			<td className="px-6 py-4">
				<Link
					to={`/workflow/${encodeURIComponent(schedule.workflowName)}`}
					className="text-slate-700 hover:text-aiki-purple transition-colors"
				>
					{schedule.workflowName}
					<span className="text-slate-400 ml-1">/ {schedule.workflowVersionId}</span>
				</Link>
			</td>
			<td className="px-6 py-4">
				<span className="text-slate-600 font-mono text-sm">{formatScheduleSpec(schedule.spec)}</span>
			</td>
			<td className="px-6 py-4">
				<ScheduleStatusBadge status={schedule.status} />
			</td>
			<td className="px-6 py-4 text-right text-slate-500">
				{schedule.status === "active" && schedule.nextRunAt ? <RelativeTime timestamp={schedule.nextRunAt} /> : "—"}
			</td>
			<td className="px-6 py-4 text-right text-slate-600">{schedule.runCount.toLocaleString()}</td>
			<td className="px-6 py-4 text-right">
				<div className="flex items-center justify-end gap-2">
					{canPause && (
						<button
							type="button"
							onClick={handlePause}
							disabled={isActioning}
							className="px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded transition-colors disabled:opacity-50"
						>
							Pause
						</button>
					)}
					{canResume && (
						<button
							type="button"
							onClick={handleResume}
							disabled={isActioning}
							className="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors disabled:opacity-50"
						>
							Resume
						</button>
					)}
					{canDelete && (
						<button
							type="button"
							onClick={handleDelete}
							disabled={isActioning}
							className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors disabled:opacity-50"
						>
							Delete
						</button>
					)}
				</div>
			</td>
		</tr>
	);
}

function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
	const config = SCHEDULE_STATUS_CONFIG[status];

	const icons: Record<string, React.ReactNode> = {
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
		trash: (
			<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={2}
					d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
				/>
			</svg>
		),
	};

	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.className}`}
		>
			{icons[config.icon]}
			{config.label}
		</span>
	);
}

function formatScheduleSpec(spec: ScheduleSpec): string {
	if (spec.type === "cron") {
		return spec.expression;
	}

	const ms = spec.everyMs;
	const days = Math.floor(ms / 86400000);
	const hours = Math.floor((ms % 86400000) / 3600000);
	const minutes = Math.floor((ms % 3600000) / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);

	if (days > 0) return `Every ${days}d${hours > 0 ? ` ${hours}h` : ""}`;
	if (hours > 0) return `Every ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
	if (minutes > 0) return `Every ${minutes}m${seconds > 0 ? ` ${seconds}s` : ""}`;
	if (seconds > 0) return `Every ${seconds}s`;
	return `Every ${ms}ms`;
}

function StatCardSkeleton() {
	return (
		<div className="rounded-2xl border-2 border-slate-200 p-6 animate-pulse">
			<div className="h-4 bg-slate-200 rounded w-16 mb-2" />
			<div className="h-10 bg-slate-200 rounded w-20" />
		</div>
	);
}
