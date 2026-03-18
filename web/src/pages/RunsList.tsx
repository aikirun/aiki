import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useWorkflowRuns } from "../api/hooks";
import { RunRow } from "../components/runs/RunRow";
import { RunsFilterBar } from "../components/runs/RunsFilterBar";
import { useDebounce } from "../hooks/useDebounce";

const PAGE_SIZE = 25;

export function RunsList() {
	const [searchParams, setSearchParams] = useSearchParams();

	// Local filter state (immediate)
	const [idFilter, setIdFilter] = useState(searchParams.get("id") ?? "");
	const [referenceIdFilter, setReferenceIdFilter] = useState(searchParams.get("refId") ?? "");
	const [scheduleIdFilter, setScheduleIdFilter] = useState(searchParams.get("scheduleId") ?? "");
	const [workflowFilter, setWorkflowFilter] = useState(searchParams.get("workflow") ?? "");
	const [versionFilter, setVersionFilter] = useState(searchParams.get("version") ?? "");
	const [selectedStatuses, setSelectedStatuses] = useState<WorkflowRunStatus[]>(() => {
		const s = searchParams.get("status");
		return s ? (s.split(",") as WorkflowRunStatus[]) : [];
	});

	const page = Number(searchParams.get("page") ?? "0");

	// Debounced values for API
	const debouncedId = useDebounce(idFilter, 500);
	const debouncedRefId = useDebounce(referenceIdFilter, 500);
	const debouncedScheduleId = useDebounce(scheduleIdFilter, 500);

	// Sync to URL
	const updateParams = (updates: Record<string, string>) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			for (const [k, v] of Object.entries(updates)) {
				if (v) {
					next.set(k, v);
				} else {
					next.delete(k);
				}
			}
			next.delete("page"); // Reset page on filter change
			return next;
		});
	};

	const handleWorkflowChange = (v: string) => {
		setWorkflowFilter(v);
		setVersionFilter("");
		updateParams({ workflow: v, version: "" });
	};

	const handleVersionChange = (v: string) => {
		setVersionFilter(v);
		updateParams({ version: v });
	};

	const handleStatusChange = (statuses: WorkflowRunStatus[]) => {
		setSelectedStatuses(statuses);
		updateParams({ status: statuses.join(",") });
	};

	// Build API request
	const apiParams = useMemo(() => {
		const filters: Record<string, unknown> = {};

		if (debouncedId) filters.id = debouncedId;
		if (debouncedScheduleId) filters.scheduleId = debouncedScheduleId;
		if (selectedStatuses.length > 0) filters.status = selectedStatuses;

		if (workflowFilter) {
			const wf: Record<string, string> = { name: workflowFilter, source: "user" };
			if (versionFilter) wf.versionId = versionFilter;
			if (debouncedRefId) wf.referenceId = debouncedRefId;
			filters.workflow = wf;
		}

		return {
			limit: PAGE_SIZE,
			offset: page * PAGE_SIZE,
			filters: Object.keys(filters).length > 0 ? filters : undefined,
			sort: { order: "desc" as const },
		};
	}, [debouncedId, debouncedRefId, debouncedScheduleId, workflowFilter, versionFilter, selectedStatuses, page]);

	const { data, isLoading } = useWorkflowRuns(apiParams);
	const runs = data?.runs ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);

	const setPage = (p: number) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			if (p === 0) {
				next.delete("page");
			} else {
				next.set("page", String(p));
			}
			return next;
		});
	};

	return (
		<div>
			<div style={{ marginBottom: 14 }}>
				<RunsFilterBar
					idFilter={idFilter}
					onIdFilterChange={(v) => {
						setIdFilter(v);
						updateParams({ id: v });
					}}
					referenceIdFilter={referenceIdFilter}
					onReferenceIdFilterChange={(v) => {
						setReferenceIdFilter(v);
						updateParams({ refId: v });
					}}
					scheduleIdFilter={scheduleIdFilter}
					onScheduleIdFilterChange={(v) => {
						setScheduleIdFilter(v);
						updateParams({ scheduleId: v });
					}}
					workflowFilter={workflowFilter}
					onWorkflowFilterChange={handleWorkflowChange}
					versionFilter={versionFilter}
					onVersionFilterChange={handleVersionChange}
					selectedStatuses={selectedStatuses}
					onSelectedStatusesChange={handleStatusChange}
				/>
			</div>

			{/* Run list */}
			<div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
				{isLoading && runs.length === 0 ? (
					<RunListSkeleton />
				) : runs.length === 0 ? (
					<div className="text-center py-12 text-t-2">
						<p className="text-sm">No runs found</p>
						<p className="text-xs text-t-3 mt-1">Adjust your filters or start a workflow</p>
					</div>
				) : (
					runs.map((run) => <RunRow key={run.id} run={run} />)
				)}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between mt-4 px-1">
					<span className="text-xs text-t-2">
						{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
					</span>
					<div className="flex gap-1">
						<button
							type="button"
							disabled={page === 0}
							onClick={() => setPage(page - 1)}
							className="px-2.5 py-1 text-xs rounded bg-surface-s2 text-t-1 hover:bg-surface-s3 disabled:opacity-30 disabled:cursor-not-allowed"
						>
							Prev
						</button>
						<button
							type="button"
							disabled={page >= totalPages - 1}
							onClick={() => setPage(page + 1)}
							className="px-2.5 py-1 text-xs rounded bg-surface-s2 text-t-1 hover:bg-surface-s3 disabled:opacity-30 disabled:cursor-not-allowed"
						>
							Next
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function RunListSkeleton() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
			{["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => (
				<div
					key={key}
					style={{
						height: 56,
						borderRadius: 8,
						backgroundColor: "var(--s1)",
					}}
					className="animate-pulse"
				/>
			))}
		</div>
	);
}
