import type { Schedule, ScheduleStatus } from "@aikirun/types/schedule";
import { useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { client } from "../api/client";
import { useSchedules, useWorkflowVersions } from "../api/hooks";
import { CopyButton } from "../components/common/CopyButton";
import { WorkflowSearchInput } from "../components/runs/WorkflowSearchInput";
import { SCHEDULE_STATUS_CONFIG } from "../constants/schedule-status";
import { useDebounce } from "../hooks/useDebounce";

const ALL_SCHEDULE_STATUSES: ScheduleStatus[] = ["active", "paused", "deleted"];
const PAGE_SIZE = 25;

// --- Shared styles ---

const inputStyle: CSSProperties = {
	backgroundColor: "var(--s1)",
	border: "1px solid var(--b0)",
	borderRadius: 6,
	padding: "5px 9px",
	fontFamily: "var(--mono, 'IBM Plex Mono', monospace)",
	fontSize: 11.5,
	color: "var(--t0)",
	outline: "none",
	width: "100%",
};

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
		<div style={{ flex: 1, minWidth: 0 }}>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				style={inputStyle}
			/>
		</div>
	);
}

function SchedulePill({ status }: { status: ScheduleStatus }) {
	const config = SCHEDULE_STATUS_CONFIG[status];
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "2px 8px",
				borderRadius: 999,
				background: `${config.color}20`,
				border: `1px solid ${config.color}35`,
				fontSize: 10.5,
				fontWeight: 600,
				color: config.color,
			}}
		>
			<span style={{ fontSize: 8 }}>{config.glyph}</span>
			{config.label}
		</span>
	);
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				background: `${color}20`,
				border: `1px solid ${color}35`,
				color,
				fontSize: 11.5,
				fontWeight: 600,
				padding: "5px 13px",
				borderRadius: 7,
				cursor: "pointer",
				fontFamily: "inherit",
			}}
		>
			{label}
		</button>
	);
}

function Meta({ label, value, copyable }: { label: string; value: string | number; copyable?: boolean }) {
	return (
		<div>
			<div
				style={{
					fontSize: 9,
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.07em",
					color: "var(--t3)",
					marginBottom: 2,
				}}
			>
				{label}
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
				<span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 500, color: "var(--t0)" }}>{value}</span>
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

	const handleAction = async (action: "pause" | "resume" | "delete", id: string) => {
		if (action === "pause") await client.schedule.pauseV1({ id });
		else if (action === "resume") await client.schedule.resumeV1({ id });
		else if (action === "delete") await client.schedule.deleteV1({ id });
		queryClient.invalidateQueries({ queryKey: ["schedules"] });
	};

	const handleViewRuns = (scheduleId: string) => {
		navigate(`/?scheduleId=${scheduleId}`);
	};

	return (
		<div className="anim-in">
			{/* Filters */}
			<div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
				<div style={{ display: "flex", gap: 8 }}>
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
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<div style={{ flex: 1 }}>
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
							style={{ ...inputStyle, width: "auto", cursor: "pointer" }}
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
					{ALL_SCHEDULE_STATUSES.map((status) => {
						const config = SCHEDULE_STATUS_CONFIG[status];
						const isActive = selectedStatuses.includes(status);
						return (
							<button
								key={status}
								type="button"
								onClick={() => toggleStatus(status)}
								style={{
									padding: "3px 8px",
									borderRadius: 999,
									fontSize: 10,
									fontWeight: 600,
									cursor: "pointer",
									transition: "all 0.12s",
									fontFamily: "inherit",
									...(isActive
										? {
												color: config.color,
												background: `${config.color}20`,
												border: `1px solid ${config.color}35`,
											}
										: {
												color: "var(--t3)",
												background: "transparent",
												border: "1px solid var(--b0)",
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

			{/* Schedule list */}
			<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
				{isLoading && schedules.length === 0 ? (
					["a", "b", "c", "d"].map((key) => (
						<div key={key} style={{ height: 64, borderRadius: 8, background: "var(--s1)" }} className="animate-pulse" />
					))
				) : schedules.length === 0 ? (
					<div style={{ padding: 40, textAlign: "center", color: "var(--t3)", fontSize: 13 }}>No schedules match</div>
				) : (
					schedules.map((item, i) => (
						<ScheduleRow
							key={item.schedule.id}
							schedule={item.schedule}
							runCount={item.runCount}
							idx={i}
							onViewRuns={handleViewRuns}
							onAction={handleAction}
						/>
					))
				)}
			</div>

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
					<span style={{ fontSize: 10, color: "var(--t3)" }}>
						{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
					</span>
					<div style={{ display: "flex", gap: 4 }}>
						<button
							type="button"
							disabled={page === 0}
							onClick={() => setPage(page - 1)}
							style={{
								padding: "4px 10px",
								fontSize: 11,
								borderRadius: 6,
								background: "var(--s2)",
								border: "1px solid var(--b0)",
								color: "var(--t1)",
								cursor: page === 0 ? "not-allowed" : "pointer",
								opacity: page === 0 ? 0.3 : 1,
								fontFamily: "inherit",
							}}
						>
							Prev
						</button>
						<button
							type="button"
							disabled={page >= totalPages - 1}
							onClick={() => setPage(page + 1)}
							style={{
								padding: "4px 10px",
								fontSize: 11,
								borderRadius: 6,
								background: "var(--s2)",
								border: "1px solid var(--b0)",
								color: "var(--t1)",
								cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
								opacity: page >= totalPages - 1 ? 0.3 : 1,
								fontFamily: "inherit",
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
	onAction: (action: "pause" | "resume" | "delete", id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const spec = schedule.spec;
	const isCron = spec.type === "cron";
	const specLabel = spec.type === "cron" ? spec.expression : `every ${fmtMs(spec.everyMs)}`;

	const viewRuns = (e: React.MouseEvent) => {
		e.stopPropagation();
		onViewRuns(schedule.id);
	};

	return (
		<div className="anim-in" style={{ animationDelay: `${idx * 30}ms` }}>
			{/* Collapsed row */}
			<button
				type="button"
				onClick={() => setOpen(!open)}
				style={{
					display: "block",
					width: "100%",
					textAlign: "left",
					padding: "12px 16px",
					background: "var(--s1)",
					border: `1px solid ${open ? "var(--b0)" : "transparent"}`,
					borderRadius: open ? "8px 8px 0 0" : 8,
					cursor: "pointer",
					transition: "all 0.12s",
					font: "inherit",
					color: "inherit",
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = "var(--s2)";
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = "var(--s1)";
				}}
			>
				<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
					<div style={{ flex: 1, minWidth: 0 }}>
						{/* Line 1: name, version, status pill, spec badge */}
						<div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, flexWrap: "wrap" }}>
							<span style={{ fontSize: 13, fontWeight: 700, color: "var(--t0)" }}>{schedule.workflowName}</span>
							<span
								style={{
									fontFamily: "monospace",
									fontSize: 10,
									color: "var(--t3)",
									background: "var(--s3)",
									padding: "1px 5px",
									borderRadius: 4,
								}}
							>
								v{schedule.workflowVersionId}
							</span>
							<SchedulePill status={schedule.status} />
							<span
								style={{
									fontFamily: "monospace",
									fontSize: 10,
									padding: "1px 6px",
									borderRadius: 4,
									background: isCron ? "rgba(129,140,248,0.08)" : "rgba(56,189,248,0.08)",
									color: isCron ? "#818CF8" : "#38BDF8",
									border: `1px solid ${isCron ? "rgba(129,140,248,0.15)" : "rgba(56,189,248,0.15)"}`,
								}}
							>
								{specLabel}
							</span>
						</div>

						{/* Line 2: short ID, ref, run count, overlap */}
						<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "var(--t3)" }}>
							<span style={{ display: "flex", alignItems: "center", gap: 2 }}>
								<span style={{ fontFamily: "monospace", fontSize: 10 }}>{shortId(schedule.id)}</span>
								<CopyButton text={schedule.id} />
							</span>
							{schedule.options?.reference?.id && (
								<span style={{ display: "flex", alignItems: "center", gap: 2 }}>
									<span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--t2)" }}>
										ref:{schedule.options.reference.id}
									</span>
									<CopyButton text={schedule.options.reference.id} />
								</span>
							)}
							<button
								type="button"
								onClick={viewRuns}
								style={{
									color: "#38BDF8",
									cursor: "pointer",
									borderBottom: "1px dashed #38BDF8",
									paddingBottom: 1,
									background: "none",
									border: "none",
									padding: 0,
									font: "inherit",
									fontSize: "inherit",
								}}
							>
								{runCount.toLocaleString()} runs →
							</button>
							{schedule.spec.overlapPolicy && (
								<span
									style={{
										fontFamily: "monospace",
										fontSize: 9.5,
										color: "var(--t3)",
										background: "var(--s3)",
										padding: "1px 5px",
										borderRadius: 3,
									}}
								>
									{schedule.spec.overlapPolicy}
								</span>
							)}
						</div>
					</div>

					{/* Right side: next run + last occurrence */}
					<div style={{ textAlign: "right", flexShrink: 0 }}>
						{schedule.status === "active" && schedule.nextRunAt > 0 && (
							<div style={{ fontSize: 11, fontFamily: "monospace", color: "#38BDF8", fontWeight: 500 }}>
								next {timeUntil(schedule.nextRunAt)}
							</div>
						)}
						{schedule.lastOccurrence && (
							<div style={{ fontSize: 10, color: "var(--t3)", marginTop: 2 }}>
								last {timeAgo(schedule.lastOccurrence)} ago
							</div>
						)}
					</div>
				</div>
			</button>

			{/* Expanded detail */}
			{open && (
				<div
					className="anim-in"
					style={{
						background: "var(--s2)",
						border: "1px solid var(--b0)",
						borderTop: "none",
						borderRadius: "0 0 8px 8px",
						padding: "14px 16px",
					}}
				>
					{/* Metadata row */}
					<div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12 }}>
						<Meta label="ID" value={schedule.id} copyable />
						<Meta label="Type" value={schedule.spec.type} />
						{schedule.spec.type === "cron" && <Meta label="Expression" value={schedule.spec.expression} />}
						{schedule.spec.type === "cron" && schedule.spec.timezone && (
							<Meta label="Timezone" value={schedule.spec.timezone} />
						)}
						{schedule.spec.type === "interval" && <Meta label="Interval" value={fmtMs(schedule.spec.everyMs)} />}
						{schedule.spec.overlapPolicy && <Meta label="Overlap" value={schedule.spec.overlapPolicy} />}
						<Meta label="Total Runs" value={runCount.toLocaleString()} />
						<Meta label="Created" value={fmtDate(schedule.createdAt)} />
					</div>

					{/* Input JSON */}
					{schedule.input != null && Object.keys(schedule.input as Record<string, unknown>).length > 0 && (
						<div style={{ marginBottom: 12 }}>
							<div
								style={{
									fontSize: 9,
									fontWeight: 700,
									textTransform: "uppercase",
									letterSpacing: "0.07em",
									color: "var(--t3)",
									marginBottom: 4,
								}}
							>
								Input
							</div>
							<pre
								style={{
									fontFamily: "monospace",
									fontSize: 11,
									color: "var(--t1)",
									lineHeight: 1.5,
									whiteSpace: "pre-wrap",
									margin: 0,
								}}
							>
								{JSON.stringify(schedule.input, null, 2)}
							</pre>
						</div>
					)}

					{/* Action buttons */}
					<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
						{schedule.status === "active" && (
							<ActionBtn label="Pause" color="#FBBF24" onClick={() => onAction("pause", schedule.id)} />
						)}
						{schedule.status === "paused" && (
							<ActionBtn label="Resume" color="#34D399" onClick={() => onAction("resume", schedule.id)} />
						)}
						{schedule.status !== "deleted" && (
							<ActionBtn label="Delete" color="#F87171" onClick={() => onAction("delete", schedule.id)} />
						)}
						<div style={{ flex: 1 }} />
						<button
							type="button"
							onClick={() => onViewRuns(schedule.id)}
							style={{
								background: "none",
								border: "1px solid var(--b0)",
								color: "#38BDF8",
								fontSize: 11,
								fontWeight: 600,
								fontFamily: "inherit",
								padding: "5px 13px",
								borderRadius: 7,
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								gap: 5,
							}}
						>
							View runs <span style={{ fontSize: 13 }}>→</span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
