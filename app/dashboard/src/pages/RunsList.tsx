import type { WorkflowRunStatus } from "@aikirun/types/workflow/run";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useWorkflowRuns } from "../api/hooks";
import { btnSecondary, card, cardGrid, LIST_ROWS, secondaryHover } from "../components/common/ui";
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

	// Remember the current filtered URL so the run-detail "← Runs" link can return here with filters intact.
	useEffect(() => {
		sessionStorage.setItem("runsListSearch", searchParams.toString());
	}, [searchParams]);

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
			<div style={{ marginBottom: 16 }}>
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

			{/* Run list — one enclosed grid, rows separated by hairlines */}
			{isLoading && runs.length === 0 ? (
				<RunListSkeleton />
			) : runs.length === 0 ? (
				<div style={{ ...card, padding: "64px 24px", textAlign: "center" }}>
					<p
						style={{
							margin: 0,
							fontSize: 17,
							fontWeight: 700,
							letterSpacing: "-0.024em",
							color: "var(--t0)",
						}}
					>
						No runs match these filters
					</p>
					<p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--t3)" }}>
						Clear a filter, or start a workflow to see it here.
					</p>
				</div>
			) : (
				<div className={LIST_ROWS} style={cardGrid}>
					{runs.map((run) => (
						<RunRow key={run.id} run={run} />
					))}
				</div>
			)}

			{/* Pagination */}
			{totalPages > 1 && (
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
					<span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t3)" }}>
						{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
					</span>
					<div style={{ display: "flex", gap: 6 }}>
						<PageButton label="Prev" disabled={page === 0} onClick={() => setPage(page - 1)} />
						<PageButton label="Next" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} />
					</div>
				</div>
			)}
		</div>
	);
}

function PageButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			style={{
				...btnSecondary(),
				fontSize: 12,
				padding: "5px 12px",
				opacity: disabled ? 0.35 : 1,
				cursor: disabled ? "not-allowed" : "pointer",
			}}
			{...(disabled ? {} : secondaryHover)}
		>
			{label}
		</button>
	);
}

function RunListSkeleton() {
	return (
		<div className={LIST_ROWS} style={cardGrid}>
			{["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => (
				<div key={key} style={{ height: 62, backgroundColor: "var(--s1)" }}>
					<div style={{ height: "100%", background: "var(--s2)", opacity: 0.5 }} className="animate-pulse" />
				</div>
			))}
		</div>
	);
}
