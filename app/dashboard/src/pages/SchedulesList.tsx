import { SCHEDULE_STATUSES, type Schedule, type ScheduleStatus } from "@aikirun/types/schedule";
import type { WorkflowRunOptions } from "@aikirun/types/workflow/run";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { namespaceAuthedClient } from "../api/client";
import { useSchedules, useWorkflowVersions } from "../api/hooks";
import { CopyButton } from "../components/common/CopyButton";
import { DataBlock } from "../components/common/DataBlock";
import {
	btnSecondary,
	btnTinted,
	card,
	cardGrid,
	chipNeutral,
	chipStatus,
	fieldLabel,
	inputFocusProps,
	inputStyle,
	LIST_ROWS,
} from "../components/common/ui";
import { WorkflowSearchInput } from "../components/runs/WorkflowSearchInput";
import { SCHEDULE_STATUS_CONFIG } from "../constants/schedule-status";
import { edge, tint } from "../constants/status-colors";
import { useDebounce } from "../hooks/useDebounce";
import { useElementWidth } from "../hooks/useElementWidth";

const PAGE_SIZE = 25;

// --- Shared styles ---

function FilterInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
}) {
	return (
		// A 160px basis, not `flex: 1`: these fields either all share a row or all take
		// one each, rather than two sharing while the third stretches to the full width.
		<div style={{ flex: "1 1 160px", minWidth: 0 }}>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				style={inputStyle}
				{...inputFocusProps}
			/>
		</div>
	);
}

function SchedulePill({ status }: { status: ScheduleStatus }) {
	const config = SCHEDULE_STATUS_CONFIG[status];
	return (
		<span style={chipStatus(config.color)}>
			<span style={{ fontSize: 8 }}>{config.glyph}</span>
			{config.label}
		</span>
	);
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} style={{ ...btnTinted(color), fontSize: 11.5, padding: "5px 12px" }}>
			{label}
		</button>
	);
}

function Meta({ label, value, copyable }: { label: string; value: string | number; copyable?: boolean }) {
	return (
		// A full id is one unbroken token wider than a phone's card. Bounded by the
		// row and allowed to break, it takes two lines instead of running off the edge.
		<div style={{ minWidth: 0, maxWidth: "100%" }}>
			<div style={{ ...fieldLabel(), marginBottom: 3 }}>{label}</div>
			<div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
				<span
					style={{
						fontFamily: "var(--mono)",
						fontSize: 12,
						fontWeight: 500,
						color: "var(--t0)",
						minWidth: 0,
						overflowWrap: "break-word",
					}}
				>
					{value}
				</span>
				{copyable && <CopyButton text={String(value)} />}
			</div>
		</div>
	);
}

function shortId(id: string): string {
	return id.length > 10 ? id.slice(-6) : id;
}

function fmtMs(ms: number): string {
	if (ms < 60000) return `${Math.round(ms / 1000)}s`;
	if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
	return `${Math.round(ms / 3600000)}h`;
}

function fmtDelay(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = ms / 1000;
	return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

function retrySummary(retry: NonNullable<WorkflowRunOptions["retry"]>): string {
	switch (retry.type) {
		case "never":
			return "never";
		case "fixed":
			return `fixed · ${retry.maxAttempts}× · ${fmtDelay(retry.delayMs)}`;
		case "exponential":
		case "jittered": {
			const parts = [retry.type, `${retry.maxAttempts}×`, `${fmtDelay(retry.baseDelayMs)} base`];
			if (retry.factor !== undefined) parts.push(`×${retry.factor}`);
			if (retry.maxDelayMs !== undefined) parts.push(`≤ ${fmtDelay(retry.maxDelayMs)}`);
			return parts.join(" · ");
		}
		default:
			return retry satisfies never;
	}
}

function fmtDate(ts: number): string {
	return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function timeUntil(ts: number): string {
	const d = ts - Date.now();
	if (d <= 0) return "now";
	if (d < 60000) return `${Math.floor(d / 1000)}s`;
	if (d < 3600000) return `${Math.floor(d / 60000)}m`;
	return `${Math.floor(d / 3600000)}h`;
}

function timeAgo(ts: number): string {
	const d = Date.now() - ts;
	if (d < 60000) return `${Math.floor(d / 1000)}s`;
	if (d < 3600000) return `${Math.floor(d / 60000)}m`;
	if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
	return `${Math.floor(d / 86400000)}d`;
}

// --- Main page ---

export function SchedulesList() {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [idFilter, setIdFilter] = useState(searchParams.get("id") ?? "");
	const [refIdFilter, setRefIdFilter] = useState(searchParams.get("refId") ?? "");
	const [workflowFilter, setWorkflowFilter] = useState(searchParams.get("workflow") ?? "");
	const [versionFilter, setVersionFilter] = useState(searchParams.get("version") ?? "");
	const [selectedStatuses, setSelectedStatuses] = useState<ScheduleStatus[]>(() => {
		const s = searchParams.get("status");
		return s ? (s.split(",") as ScheduleStatus[]) : [];
	});

	const debouncedId = useDebounce(idFilter, 500);
	const debouncedRefId = useDebounce(refIdFilter, 500);

	const page = Number(searchParams.get("page") ?? "0");

	const { data: versionsData } = useWorkflowVersions(workflowFilter);

	const updateParams = (updates: Record<string, string>) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			for (const [k, v] of Object.entries(updates)) {
				if (v) next.set(k, v);
				else next.delete(k);
			}
			next.delete("page");
			return next;
		});
	};

	const toggleStatus = (status: ScheduleStatus) => {
		const next = selectedStatuses.includes(status)
			? selectedStatuses.filter((s) => s !== status)
			: [...selectedStatuses, status];
		setSelectedStatuses(next);
		updateParams({ status: next.join(",") });
	};

	const apiParams = useMemo(() => {
		const filters: Record<string, unknown> = {};
		if (debouncedId) filters.id = debouncedId;
		if (debouncedRefId) filters.referenceId = debouncedRefId;
		if (selectedStatuses.length > 0) filters.status = selectedStatuses;

		if (workflowFilter) {
			const wf: Record<string, string> = { name: workflowFilter, source: "user" };
			if (versionFilter) wf.versionId = versionFilter;
			filters.workflows = [wf];
		}

		return {
			limit: PAGE_SIZE,
			offset: page * PAGE_SIZE,
			filters: Object.keys(filters).length > 0 ? filters : undefined,
			sort: { order: "desc" as const },
		};
	}, [debouncedId, debouncedRefId, workflowFilter, versionFilter, selectedStatuses, page]);

	const { data, isLoading } = useSchedules(apiParams);
	const schedules = data?.schedules ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);

	const setPage = (p: number) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			if (p === 0) next.delete("page");
			else next.set("page", String(p));
			return next;
		});
	};

	const handleAction = async (action: "pause" | "resume" | "deactivate", id: string) => {
		if (action === "pause") await namespaceAuthedClient.schedule.pauseV1({ id });
		else if (action === "resume") await namespaceAuthedClient.schedule.resumeV1({ id });
		else if (action === "deactivate") await namespaceAuthedClient.schedule.deactivateV1({ id });
		queryClient.invalidateQueries({ queryKey: ["schedules"] });
	};

	const handleViewRuns = (scheduleId: string) => {
		navigate(`/?scheduleId=${scheduleId}`);
	};

	return (
		<div className="anim-in">
			{/* Filters */}
			<div
				style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}
			>
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<FilterInput
						value={idFilter}
						onChange={(v) => {
							setIdFilter(v);
							updateParams({ id: v });
						}}
						placeholder="Schedule ID"
					/>
					<FilterInput
						value={refIdFilter}
						onChange={(v) => {
							setRefIdFilter(v);
							updateParams({ refId: v });
						}}
						placeholder="Reference ID"
					/>
				</div>
				<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
					{/* A real basis so the version select drops to its own line rather than
					    squeezing the name field to a few characters. */}
					<div style={{ flex: "1 1 200px", minWidth: 0 }}>
						<WorkflowSearchInput
							value={workflowFilter}
							onChange={(v) => {
								setWorkflowFilter(v);
								setVersionFilter("");
								updateParams({ workflow: v, version: "" });
							}}
						/>
					</div>
					{workflowFilter && versionsData?.versions && versionsData.versions.length > 0 && (
						<select
							value={versionFilter}
							onChange={(e) => {
								setVersionFilter(e.target.value);
								updateParams({ version: e.target.value });
							}}
							style={{ ...inputStyle, flex: "0 1 auto", width: "auto", minWidth: 0, cursor: "pointer" }}
						>
							<option value="">All versions</option>
							{versionsData.versions.map((v) => (
								<option key={v.versionId} value={v.versionId}>
									{v.versionId.slice(0, 8)}
								</option>
							))}
						</select>
					)}
				</div>

				{/* Status chips */}
				<div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
					{SCHEDULE_STATUSES.map((status) => {
						const config = SCHEDULE_STATUS_CONFIG[status];
						const isActive = selectedStatuses.includes(status);
						return (
							<button
								key={status}
								type="button"
								onClick={() => toggleStatus(status)}
								style={{
									padding: "4px 9px",
									borderRadius: "var(--r-chip)",
									fontFamily: "var(--sans)",
									fontSize: 11,
									fontWeight: 600,
									lineHeight: 1.45,
									cursor: "pointer",
									transition: "color .16s ease, background-color .16s ease, border-color .16s ease",
									...(isActive
										? {
												color: config.color,
												background: tint(config.color),
												border: `1px solid ${edge(config.color)}`,
											}
										: {
												color: "var(--t2)",
												background: "var(--s2)",
												border: "1px solid transparent",
											}),
								}}
							>
								{config.label}
							</button>
						);
					})}
					{selectedStatuses.length > 0 && (
						<button
							type="button"
							onClick={() => {
								setSelectedStatuses([]);
								updateParams({ status: "" });
							}}
							style={{
								background: "none",
								border: "none",
								color: "var(--t3)",
								fontSize: 10,
								cursor: "pointer",
								padding: "3px 6px",
								fontFamily: "inherit",
							}}
						>
							Clear
						</button>
					)}
				</div>
			</div>

			{/* Schedule list — one enclosed grid, rows separated by hairlines */}
			{schedules.length === 0 && !isLoading ? (
				<div style={{ ...card, padding: "64px 24px", textAlign: "center" }}>
					<p style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.024em", color: "var(--t0)" }}>
						No schedules match these filters
					</p>
					<p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--t3)" }}>
						Clear a filter, or create a schedule to see it here.
					</p>
				</div>
			) : (
				<div className={LIST_ROWS} style={cardGrid}>
					{isLoading && schedules.length === 0
						? ["a", "b", "c", "d"].map((key) => (
								<div key={key} style={{ height: 70, background: "var(--s1)" }} className="animate-pulse" />
							))
						: schedules.map((item, i) => (
								<ScheduleRow
									key={item.schedule.id}
									schedule={item.schedule}
									runCount={item.runCount}
									idx={i}
									onViewRuns={handleViewRuns}
									onAction={handleAction}
								/>
							))}
				</div>
			)}

			{/* Pagination */}
			{totalPages > 1 && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginTop: 16,
						padding: "0 4px",
					}}
				>
					<span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t3)" }}>
						{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
					</span>
					<div style={{ display: "flex", gap: 4 }}>
						<button
							type="button"
							disabled={page === 0}
							onClick={() => setPage(page - 1)}
							style={{
								...btnSecondary(),
								fontSize: 12,
								padding: "5px 12px",
								cursor: page === 0 ? "not-allowed" : "pointer",
								opacity: page === 0 ? 0.35 : 1,
							}}
						>
							Prev
						</button>
						<button
							type="button"
							disabled={page >= totalPages - 1}
							onClick={() => setPage(page + 1)}
							style={{
								...btnSecondary(),
								fontSize: 12,
								padding: "5px 12px",
								cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
								opacity: page >= totalPages - 1 ? 0.35 : 1,
							}}
						>
							Next
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

// --- Schedule Row ---

function ScheduleRow({
	schedule,
	runCount,
	idx,
	onViewRuns,
	onAction,
}: {
	schedule: Schedule;
	runCount: number;
	idx: number;
	onViewRuns: (id: string) => void;
	onAction: (action: "pause" | "resume" | "deactivate", id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [rowRef, rowWidth] = useElementWidth<HTMLDivElement>();
	const showRef = rowWidth >= 480;
	const showOverlap = rowWidth >= 380;
	const spec = schedule.spec;
	const isCron = spec.type === "cron";
	const specLabel = spec.type === "cron" ? spec.expression : `every ${fmtMs(spec.everyMs)}`;

	const viewRuns = (e: React.MouseEvent) => {
		e.stopPropagation();
		onViewRuns(schedule.id);
	};

	return (
		<div ref={rowRef} className="anim-in" style={{ animationDelay: `${idx * 30}ms` }}>
			{/* Collapsed row — the workflow name is the toggle; everything else sits beside it */}
			<div
				className="list-row"
				style={{
					position: "relative",
					width: "100%",
					textAlign: "left",
					padding: "13px 18px",
				}}
			>
				<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
					<div style={{ flex: 1, minWidth: 0 }}>
						{/* Line 1: name, version, status pill, spec badge */}
						<div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, flexWrap: "wrap" }}>
							<button
								type="button"
								className="row-target"
								aria-expanded={open}
								onClick={() => setOpen(!open)}
								style={{
									background: "none",
									border: "none",
									padding: 0,
									cursor: "pointer",
									fontFamily: "var(--sans)",
									fontSize: 13.5,
									fontWeight: 700,
									letterSpacing: "-0.018em",
									color: "var(--t0)",
									textAlign: "left",
								}}
							>
								{schedule.workflowName}
							</button>
							<span style={chipNeutral()}>v{schedule.workflowVersionId}</span>
							<SchedulePill status={schedule.status} />
							<span style={chipStatus(isCron ? "var(--accent-indigo)" : "var(--accent-sky)")}>{specLabel}</span>
						</div>

						{/* Line 2: short ID, ref, overlap */}
						<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "var(--t3)" }}>
							<span style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
								<span style={{ fontFamily: "var(--mono)", fontSize: 10, whiteSpace: "nowrap" }}>
									<span style={{ opacity: 0.62 }}>ID</span> {shortId(schedule.id)}
								</span>
								<CopyButton text={schedule.id} />
							</span>
							{showRef && schedule.referenceId && (
								<>
									<span style={{ fontSize: 10, color: "var(--b0)", marginLeft: -2, marginRight: 2 }}>•</span>
									<span style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
										<span
											style={{
												fontFamily: "var(--mono)",
												fontSize: 10,
												color: "var(--t3)",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												maxWidth: 120,
											}}
											title={schedule.referenceId}
										>
											<span style={{ opacity: 0.62 }}>REF</span> {schedule.referenceId}
										</span>
										<CopyButton text={schedule.referenceId} />
									</span>
								</>
							)}
							{showOverlap && schedule.spec.overlapPolicy && (
								<span style={{ ...chipNeutral(), fontSize: 9.5 }}>overlap {schedule.spec.overlapPolicy}</span>
							)}
						</div>
					</div>

					{/* Right side: next/last occurrence + runs link */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "flex-end",
							justifyContent: "space-between",
							alignSelf: "stretch",
							flexShrink: 0,
							gap: 8,
						}}
					>
						<div style={{ textAlign: "right" }}>
							{schedule.status === "active" && schedule.nextRunAt > 0 && (
								<div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--accent-sky)", fontWeight: 500 }}>
									next {timeUntil(schedule.nextRunAt)}
								</div>
							)}
							{schedule.lastOccurrence && (
								<div style={{ fontSize: 10, color: "var(--t3)", marginTop: 2 }}>
									last {timeAgo(schedule.lastOccurrence)} ago
								</div>
							)}
						</div>
						<button
							type="button"
							onClick={viewRuns}
							style={{
								position: "relative",
								zIndex: 1,
								color: "var(--accent-sky)",
								cursor: "pointer",
								borderBottom: "1px dashed currentColor",
								paddingBottom: 1,
								background: "none",
								border: "none",
								padding: 0,
								font: "inherit",
								fontSize: 11,
								whiteSpace: "nowrap",
							}}
						>
							{runCount.toLocaleString()} runs →
						</button>
					</div>
				</div>
			</div>

			{/* Expanded detail */}
			{open && (
				<div
					className="anim-in"
					style={{
						background: "var(--s2)",
						borderTop: "1px solid var(--b0)",
						padding: "16px 18px",
					}}
				>
					{/* Metadata row */}
					<div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12 }}>
						<Meta label="ID" value={schedule.id} copyable />
						{schedule.referenceId && <Meta label="Reference" value={schedule.referenceId} copyable />}
						<Meta label="Type" value={schedule.spec.type} />
						{schedule.spec.type === "cron" && <Meta label="Expression" value={schedule.spec.expression} />}
						{schedule.spec.type === "cron" && schedule.spec.timezone && (
							<Meta label="Timezone" value={schedule.spec.timezone} />
						)}
						{schedule.spec.type === "interval" && <Meta label="Interval" value={fmtMs(schedule.spec.everyMs)} />}
						{schedule.spec.overlapPolicy && <Meta label="Overlap" value={schedule.spec.overlapPolicy} />}
						{schedule.workflowRunOptions?.retry && (
							<Meta label="Retry" value={retrySummary(schedule.workflowRunOptions.retry)} />
						)}
						{schedule.workflowRunOptions?.pool && <Meta label="Pool" value={schedule.workflowRunOptions.pool} />}
						<Meta label="Total Runs" value={runCount.toLocaleString()} />
						<Meta label="Created" value={fmtDate(schedule.createdAt)} />
					</div>

					{/* Input JSON */}
					{schedule.workflowRunInput != null &&
						Object.keys(schedule.workflowRunInput as Record<string, unknown>).length > 0 && (
							<div style={{ marginBottom: 14 }}>
								<DataBlock label="Input" text={JSON.stringify(schedule.workflowRunInput, null, 2)} />
							</div>
						)}

					{/* Action buttons */}
					{/*
					 * The state actions travel together and "View runs" sits opposite them.
					 * `space-between` rather than a margin on the last button: once the row
					 * wraps, a margin would push "View runs" to the right of its own line,
					 * out of line with the buttons above it.
					 */}
					<div
						style={{
							display: "flex",
							gap: 6,
							alignItems: "center",
							flexWrap: "wrap",
							justifyContent: "space-between",
						}}
					>
						<div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
							{schedule.status === "active" && (
								<ActionBtn label="Pause" color="var(--accent-amber)" onClick={() => onAction("pause", schedule.id)} />
							)}
							{schedule.status === "paused" && (
								<ActionBtn label="Resume" color="var(--accent-green)" onClick={() => onAction("resume", schedule.id)} />
							)}
							{schedule.status !== "inactive" && (
								<ActionBtn
									label="Deactivate"
									color="var(--accent-red)"
									onClick={() => onAction("deactivate", schedule.id)}
								/>
							)}
						</div>
						<button
							type="button"
							onClick={() => onViewRuns(schedule.id)}
							style={{ ...btnTinted("var(--accent-sky)"), fontSize: 11.5, padding: "5px 12px" }}
						>
							View runs <span style={{ fontSize: 13 }}>→</span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
