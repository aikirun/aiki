import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useWorkflowRuns, useWorkflowVersions } from "../api/hooks";
import { BackLink } from "../components/common/BackLink";
import { CopyButton } from "../components/common/CopyButton";
import { EmptyState } from "../components/common/EmptyState";
import { MultiSelectDropdown } from "../components/common/MultiSelectDropdown";
import { NotFound } from "../components/common/NotFound";
import { RelativeTime } from "../components/common/RelativeTime";
import { StatusBadge } from "../components/common/StatusBadge";
import { TableSkeleton } from "../components/common/TableSkeleton";
import { STATUS_OPTIONS, type StatusOption } from "../constants/workflow-status";
import { useDebounce } from "../hooks/useDebounce";

export function WorkflowDetail() {
	const { name } = useParams<{ name: string }>();
	const decodedName = name ? decodeURIComponent(name) : "";
	const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
	const [selectedStatuses, setSelectedStatuses] = useState<StatusOption[]>([]);
	const [referenceIdFilter, setReferenceIdFilter] = useState<string>("");
	const [runIdFilter, setRunIdFilter] = useState<string>("");

	const debouncedReferenceIdFilter = useDebounce(referenceIdFilter, 500);
	const debouncedRunIdFilter = useDebounce(runIdFilter, 500);

	const {
		data: versions,
		isLoading: versionsLoading,
		error: versionsError,
	} = useWorkflowVersions(decodedName, {
		sort: { field: "firstSeenAt", order: "desc" },
	});

	const workflowFilters =
		selectedVersions.length > 0
			? selectedVersions.map((versionId) => ({
					name: decodedName,
					versionId,
					...(debouncedReferenceIdFilter && { referenceId: debouncedReferenceIdFilter }),
				}))
			: [{ name: decodedName, ...(debouncedReferenceIdFilter && { referenceId: debouncedReferenceIdFilter }) }];

	const selectedStatusValues = selectedStatuses.map((s) => s.value);

	const {
		data: runs,
		isLoading: runsLoading,
		isFetching: runsFetching,
		error: runsError,
	} = useWorkflowRuns({
		filters: {
			workflows: workflowFilters,
			...(selectedStatusValues.length > 0 && { status: selectedStatusValues }),
			...(debouncedRunIdFilter && { runId: debouncedRunIdFilter }),
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
			<div className="bg-white rounded-2xl border-2 border-slate-200">
				<div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between overflow-visible">
					<h2 className="font-heading text-lg font-semibold text-slate-900">Recent Runs</h2>
					<div className="flex items-center gap-2">
						{runsFetching && <span className="text-xs text-slate-400 animate-pulse">Filtering...</span>}
						<input
							type="text"
							value={runIdFilter}
							onChange={(e) => setRunIdFilter(e.target.value)}
							placeholder="Filter by Run ID"
							aria-label="Filter workflow runs by Run ID"
							className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:border-transparent"
						/>
						<input
							type="text"
							value={referenceIdFilter}
							onChange={(e) => setReferenceIdFilter(e.target.value)}
							placeholder="Filter by Reference ID"
							aria-label="Filter workflow runs by Reference ID"
							className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:border-transparent"
						/>
						<MultiSelectDropdown
							label="All Statuses"
							options={STATUS_OPTIONS}
							selected={selectedStatuses}
							onChange={setSelectedStatuses}
							getOptionValue={(opt) => opt.value}
							getOptionLabel={(opt) => opt.label}
						/>
						<MultiSelectDropdown
							label="All Versions"
							options={versions?.versions ?? []}
							selected={versions?.versions.filter((v) => selectedVersions.includes(v.versionId)) ?? []}
							onChange={(selected) => setSelectedVersions(selected.map((v) => v.versionId))}
							getOptionValue={(v) => v.versionId}
							getOptionLabel={(v) => v.versionId}
						/>
					</div>
				</div>

				{runsError && (
					<div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-600">
						Failed to load runs. {runs ? "Showing previous results." : ""}
					</div>
				)}

				{/* runsLoading is only true on initial fetch with no cached data.
				    With keepPreviousData, filter changes keep previous data visible
				    while fetching, preventing skeleton flash and scroll jumps. */}
				{runsLoading ? (
					<div className="p-6">
						<TableSkeleton rows={5} columns={5} />
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
									Reference ID
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
										<div className="flex items-center gap-1">
											<Link
												to={`/workflow/${encodeURIComponent(decodedName)}/run/${run.id}`}
												className="font-mono text-sm font-semibold text-slate-900 hover:text-aiki-purple transition-colors max-w-[100px] truncate"
												title={run.id}
											>
												{run.id}
											</Link>
											<CopyButton text={run.id} title="Copy Run ID" />
										</div>
									</td>
									<td className="px-6 py-4 font-mono text-sm text-slate-600">
										{run.referenceId ? (
											<div className="flex items-center gap-1">
												<span className="max-w-[120px] truncate" title={run.referenceId}>
													{run.referenceId}
												</span>
												<CopyButton text={run.referenceId} title="Copy Reference ID" />
											</div>
										) : (
											"—"
										)}
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
