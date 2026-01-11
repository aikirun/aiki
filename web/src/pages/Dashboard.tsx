import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { useWorkflowStats, useWorkflows } from "../api/hooks";
import { EmptyState } from "../components/common/EmptyState";
import { RefreshIcon } from "../components/common/Icons";
import { RelativeTime } from "../components/common/RelativeTime";
import { TableSkeleton } from "../components/common/TableSkeleton";
import { StatCard } from "../components/stats/StatCard";

export function Dashboard() {
	const queryClient = useQueryClient();
	const { data: stats, isLoading: statsLoading, isFetching: statsFetching } = useWorkflowStats();
	const {
		data: workflows,
		isLoading: workflowsLoading,
		isFetching: workflowsFetching,
	} = useWorkflows({
		sort: { field: "name", order: "asc" },
	});

	const isRefreshing = statsFetching || workflowsFetching;

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["workflow-stats"] });
		queryClient.invalidateQueries({ queryKey: ["workflows"] });
	};

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h1 className="font-heading text-3xl font-bold text-slate-900">Dashboard</h1>
				<button
					type="button"
					onClick={handleRefresh}
					disabled={isRefreshing}
					className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-slate-200 text-slate-700 font-semibold text-sm hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
				>
					<RefreshIcon className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
					{isRefreshing ? "Refreshing..." : "Refresh"}
				</button>
			</div>

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

			{/* Workflows Table */}
			<div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
				<div className="px-6 py-4 border-b border-slate-200">
					<h2 className="font-heading text-lg font-semibold text-slate-900">Workflows</h2>
				</div>

				{workflowsLoading ? (
					<div className="p-6">
						<TableSkeleton rows={3} columns={3} />
					</div>
				) : workflows?.workflows.length === 0 ? (
					<EmptyState title="No workflows yet" description="Workflows will appear here when runs are created" />
				) : (
					<table className="w-full">
						<thead>
							<tr className="border-b border-slate-100">
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Name
								</th>
								<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Runs
								</th>
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
				)}
			</div>
		</div>
	);
}

function StatCardSkeleton() {
	return (
		<div className="rounded-2xl border-2 border-slate-200 p-6 animate-pulse">
			<div className="h-4 bg-slate-200 rounded w-16 mb-2" />
			<div className="h-10 bg-slate-200 rounded w-20" />
		</div>
	);
}
