import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useWorkflowRuns, useWorkflowVersions } from "../api/hooks";
import { BackLink } from "../components/common/BackLink";
import { EmptyState } from "../components/common/EmptyState";
import { NotFound } from "../components/common/NotFound";
import { RelativeTime } from "../components/common/RelativeTime";
import { StatusBadge } from "../components/common/StatusBadge";
import { TableSkeleton } from "../components/common/TableSkeleton";

const STATUS_OPTIONS: { value: WorkflowRunStatus | ""; label: string }[] = [
	{ value: "", label: "All Statuses" },
	{ value: "running", label: "Running" },
	{ value: "queued", label: "Queued" },
	{ value: "scheduled", label: "Scheduled" },
	{ value: "sleeping", label: "Sleeping" },
	{ value: "awaiting_event", label: "Awaiting Event" },
	{ value: "awaiting_child_workflow", label: "Awaiting Child" },
	{ value: "awaiting_retry", label: "Awaiting Retry" },
	{ value: "paused", label: "Paused" },
	{ value: "completed", label: "Completed" },
	{ value: "failed", label: "Failed" },
	{ value: "cancelled", label: "Cancelled" },
];

export function WorkflowDetail() {
	const { name } = useParams<{ name: string }>();
	const decodedName = name ? decodeURIComponent(name) : "";
	const [selectedVersion, setSelectedVersion] = useState<string>("");
	const [selectedStatus, setSelectedStatus] = useState<WorkflowRunStatus | "">("");

	const {
		data: versions,
		isLoading: versionsLoading,
		error: versionsError,
	} = useWorkflowVersions(decodedName, {
		sort: { field: "firstSeenAt", order: "desc" },
	});

	const { data: runs, isLoading: runsLoading } = useWorkflowRuns({
		filters: {
			workflows: [
				{
					id: decodedName,
					...(selectedVersion && { versionId: selectedVersion }),
				},
			],
			...(selectedStatus && { status: [selectedStatus] }),
		},
		sort: { field: "createdAt", order: "desc" },
		limit: 20,
	});

	// Show 404 if no name provided, API error, or workflow doesn't exist
	if (!name || versionsError || (!versionsLoading && versions?.versions.length === 0)) {
		return (
			<NotFound
				title="Workflow Not Found"
				message="The workflow you're looking for doesn't exist or has no versions."
			/>
		);
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="flex items-center gap-4">
				<BackLink to="/" />
				<h1 className="font-heading text-3xl font-bold text-slate-900">{decodedName}</h1>
			</div>

			{/* Versions Table */}
			<div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
				<div className="px-6 py-4 border-b border-slate-200">
					<h2 className="font-heading text-lg font-semibold text-slate-900">Versions</h2>
				</div>

				{versionsLoading ? (
					<div className="p-6">
						<TableSkeleton rows={2} columns={4} />
					</div>
				) : versions?.versions.length === 0 ? (
					<EmptyState title="No versions found" />
				) : (
					<table className="w-full">
						<thead>
							<tr className="border-b border-slate-100">
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Version
								</th>
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									First Seen
								</th>
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Last Run
								</th>
								<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Total Runs
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{versions?.versions.map((version) => (
								<tr key={version.versionId} className="hover:bg-slate-50 transition-colors">
									<td className="px-6 py-4 font-mono text-sm font-semibold text-slate-900">{version.versionId}</td>
									<td className="px-6 py-4 text-slate-600">
										<RelativeTime timestamp={version.firstSeenAt} />
									</td>
									<td className="px-6 py-4 text-slate-500">
										{version.lastRunAt ? <RelativeTime timestamp={version.lastRunAt} /> : "—"}
									</td>
									<td className="px-6 py-4 text-right text-slate-600">{version.runCount.toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* Recent Runs Table */}
			<div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
				<div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
					<h2 className="font-heading text-lg font-semibold text-slate-900">Recent Runs</h2>
					<div className="flex items-center gap-2">
						<select
							value={selectedStatus}
							onChange={(e) => setSelectedStatus(e.target.value as WorkflowRunStatus | "")}
							className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:border-transparent"
						>
							{STATUS_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
						<select
							value={selectedVersion}
							onChange={(e) => setSelectedVersion(e.target.value)}
							className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:border-transparent"
						>
							<option value="">All Versions</option>
							{versions?.versions.map((v) => (
								<option key={v.versionId} value={v.versionId}>
									{v.versionId}
								</option>
							))}
						</select>
					</div>
				</div>

				{runsLoading ? (
					<div className="p-6">
						<TableSkeleton rows={5} columns={4} />
					</div>
				) : runs?.runs.length === 0 ? (
					<EmptyState title="No runs yet" description="Runs will appear here when workflows are started" />
				) : (
					<table className="w-full">
						<thead>
							<tr className="border-b border-slate-100">
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Run ID
								</th>
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Version
								</th>
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Status
								</th>
								<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Started
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{runs?.runs.map((run) => (
								<tr key={run.id} className="hover:bg-slate-50 transition-colors">
									<td className="px-6 py-4">
										<Link
											to={`/workflow/${encodeURIComponent(decodedName)}/run/${run.id}`}
											className="font-mono text-sm font-semibold text-slate-900 hover:text-aiki-purple transition-colors"
										>
											{run.id.slice(0, 8)}...
										</Link>
									</td>
									<td className="px-6 py-4 font-mono text-sm text-slate-600">{run.versionId}</td>
									<td className="px-6 py-4">
										<StatusBadge status={run.status} />
									</td>
									<td className="px-6 py-4 text-right text-slate-500">
										<RelativeTime timestamp={run.createdAt} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}
