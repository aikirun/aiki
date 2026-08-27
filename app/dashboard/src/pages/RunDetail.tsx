import type { ChildWorkflowRunInfo } from "@aikirun/types/workflow/run";
import { isTerminalWorkflowRunStatus } from "@aikirun/types/workflow/run";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { namespaceAuthedClient } from "../api/client";
import { useWorkflowRun, useWorkflowRunTransitions } from "../api/hooks";
import { CopyButton } from "../components/common/CopyButton";
import { SpinnerIcon } from "../components/common/Icons";
import { NotFound } from "../components/common/NotFound";
import { RelativeTime } from "../components/common/RelativeTime";
import { StatusBadge, StatusDot } from "../components/common/StatusBadge";
import { btnSecondary, btnTinted, card, chipStatus, fieldLabel, secondaryHover } from "../components/common/ui";
import { DataTab } from "../components/run-detail/DataTab";
import { ExecutionTab } from "../components/run-detail/ExecutionTab";
import { TimelineTab } from "../components/run-detail/TimelineTab";
import { buildTimelineLookups } from "../components/run-detail/timeline-lookups";
import { edge, tint, WORKFLOW_RUN_STATUS_COLORS } from "../constants/status-colors";

const POLLING_INTERVAL_MS = 2000;

type TabId = "execution" | "timeline" | "data";

function shortId(id: string): string {
	return id.slice(-6);
}

function timeUntil(ms: number): string {
	const diff = Math.max(0, Math.round((ms - Date.now()) / 1000));
	if (diff < 60) return `${diff}s`;
	if (diff < 3600) return `${Math.round(diff / 60)}m`;
	return `${Math.round(diff / 3600)}h`;
}

function ActionBtn({
	label,
	color,
	onClick,
	loading,
}: {
	label: string;
	color: string;
	onClick: () => void;
	loading?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={loading}
			style={{
				...btnTinted(color),
				fontSize: 11.5,
				padding: "5px 12px",
				cursor: loading ? "not-allowed" : "pointer",
				opacity: loading ? 0.5 : 1,
			}}
		>
			{loading && <SpinnerIcon />}
			{label}
		</button>
	);
}

interface MetaProps {
	label: string;
	children: React.ReactNode;
}

function Meta({ label, children }: MetaProps) {
	return (
		<div>
			<div style={{ ...fieldLabel(), marginBottom: 4 }}>{label}</div>
			<div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 500, color: "var(--t0)", lineHeight: "22px" }}>
				{children}
			</div>
		</div>
	);
}

export function RunDetail() {
	const { id } = useParams<{ id: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
	const runsListSearch = sessionStorage.getItem("runsListSearch") ?? "";
	const queryClient = useQueryClient();
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	// scrollToTaskId is preserved for ExecutionTab deep-link support (future use)
	const [scrollToTaskId] = useState<string | null>(null);

	const activeTab = (searchParams.get("tab") as TabId) || "execution";
	const setActiveTab = (tab: TabId) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			if (tab === "execution") next.delete("tab");
			else next.set("tab", tab);
			return next;
		});
	};

	const {
		data: runData,
		isLoading: runLoading,
		error: runError,
	} = useWorkflowRun(id || "", {
		refetchInterval: (query) => {
			const run = query.state.data?.run;
			if (!run) return false;
			return isTerminalWorkflowRunStatus(run.state.status) ? false : POLLING_INTERVAL_MS;
		},
	});

	const currentRun = runData?.run;
	const isLive = currentRun ? !isTerminalWorkflowRunStatus(currentRun.state.status) : false;

	const { data: transitions, isLoading: transitionsLoading } = useWorkflowRunTransitions(
		id || "",
		{ sort: { order: "asc" } },
		{ refetchInterval: isLive ? POLLING_INTERVAL_MS : false }
	);

	const childWorkflowRuns = useMemo(() => {
		if (!currentRun) return {};
		const result: Record<string, ChildWorkflowRunInfo> = {};
		for (const addressChildRuns of Object.values(currentRun.childWorkflowRuns)) {
			for (const child of addressChildRuns) {
				result[child.id] = child;
			}
		}
		return result;
	}, [currentRun]);

	const tasks = useMemo(() => (currentRun ? Object.values(currentRun.tasks).flat() : []), [currentRun]);

	const childRunCount = useMemo(() => Object.keys(childWorkflowRuns).length, [childWorkflowRuns]);

	const taskById = useMemo(() => {
		const map = new Map<string, (typeof tasks)[number]>();
		for (const task of tasks) {
			map.set(task.id, task);
		}
		return map;
	}, [tasks]);

	const timelineLookups = useMemo(() => {
		if (!currentRun || !transitions?.transitions) return undefined;
		return buildTimelineLookups(
			transitions.transitions,
			currentRun.eventWaits,
			currentRun.sleeps,
			childWorkflowRuns,
			currentRun.childWorkflowRunWaits,
			taskById
		);
	}, [transitions?.transitions, currentRun, childWorkflowRuns, taskById]);

	const invalidateQueries = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["workflow-run", id] });
		queryClient.invalidateQueries({ queryKey: ["workflow-run-transitions", id] });
	}, [queryClient, id]);

	const handleAction = useCallback(
		async (action: string, stateFn: () => Promise<unknown>) => {
			setActionLoading(action);
			setActionError(null);
			try {
				await stateFn();
				invalidateQueries();
			} catch (err) {
				setActionError(err instanceof Error ? err.message : `Failed to ${action}`);
			} finally {
				setActionLoading(null);
			}
		},
		[invalidateQueries]
	);

	if (runLoading) return <RunDetailSkeleton />;

	if (runError || !currentRun) {
		return (
			<NotFound
				title="Run Not Found"
				message="The workflow run you're looking for doesn't exist or may have been deleted."
			/>
		);
	}

	const status = currentRun.state.status;
	const statusColor = WORKFLOW_RUN_STATUS_COLORS[status];
	const isTerminal = isTerminalWorkflowRunStatus(status);
	const canCancel = !isTerminal;
	const canPause = ["scheduled", "queued", "running"].includes(status);
	const canResume = status === "paused";
	const canRequeue = status === "stalled";
	const canWake = status === "sleeping";

	const executionCount = tasks.length + childRunCount;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
			{/* Nav bar */}
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
				<Link
					to={{ pathname: "/", search: runsListSearch }}
					style={{ ...btnSecondary(), fontSize: 12, padding: "5px 12px", textDecoration: "none" }}
					{...secondaryHover}
				>
					← Runs
				</Link>
				{currentRun.parentWorkflowRunId && (
					<Link
						to={`/runs/${currentRun.parentWorkflowRunId}`}
						style={{
							...btnTinted("var(--accent-purple)"),
							fontSize: 11.5,
							padding: "5px 12px",
							textDecoration: "none",
						}}
					>
						↑ Parent run {shortId(currentRun.parentWorkflowRunId)}
					</Link>
				)}
				{currentRun.scheduleId && (
					<Link
						to={`/schedules?id=${currentRun.scheduleId}`}
						style={{ ...btnTinted("var(--accent-sky)"), fontSize: 11.5, padding: "5px 12px", textDecoration: "none" }}
					>
						⏱ Schedule {shortId(currentRun.scheduleId)}
					</Link>
				)}
			</div>

			{/* Hero card */}
			<div
				style={{
					...card,
					padding: "22px 24px 20px",
					marginBottom: 16,
					borderTop: `2px solid ${edge(statusColor)}`,
				}}
			>
				{/* Top row: name + pill + actions */}
				<div
					style={{
						display: "flex",
						alignItems: "flex-start",
						justifyContent: "space-between",
						flexWrap: "wrap",
						gap: 12,
						marginBottom: 8,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							flexWrap: "wrap",
							minWidth: 0,
							// A real basis, not `flex: 1`: with a 0% basis this column shrinks to a
							// sliver and the name breaks mid-word instead of the actions wrapping.
							flex: "1 1 220px",
						}}
					>
						<h1
							style={{
								margin: 0,
								fontSize: "clamp(20px, 3.4vw, 26px)",
								fontWeight: 800,
								color: "var(--t0)",
								letterSpacing: "-0.038em",
								lineHeight: 1.1,
								minWidth: 0,
								// A workflow name is one hyphenated token; without this it keeps its
								// full width as the flex item shrinks and paints over the actions.
								overflowWrap: "break-word",
							}}
						>
							{currentRun.name}
						</h1>
						<StatusBadge status={status} size="md" />
						{currentRun.parentWorkflowRunId && <span style={chipStatus("var(--accent-purple)")}>child</span>}
					</div>

					{/* Action buttons — only shown for non-terminal runs */}
					{!isTerminal && (
						<div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
							{canResume && (
								<ActionBtn
									label="Resume"
									color="var(--accent-green)"
									loading={actionLoading === "resume"}
									onClick={() =>
										handleAction("resume", () =>
											namespaceAuthedClient.workflowRun.transitionStateV1({
												type: "pessimistic",
												id: currentRun.id,
												state: { status: "scheduled", scheduledInMs: 0, reason: "resumption" },
											})
										)
									}
								/>
							)}
							{canPause && (
								<ActionBtn
									label="Pause"
									color="var(--accent-amber)"
									loading={actionLoading === "pause"}
									onClick={() =>
										handleAction("pause", () =>
											namespaceAuthedClient.workflowRun.transitionStateV1({
												type: "pessimistic",
												id: currentRun.id,
												state: { status: "paused" },
											})
										)
									}
								/>
							)}
							{canRequeue && (
								<ActionBtn
									label="Requeue"
									color="var(--accent-sky)"
									loading={actionLoading === "requeue"}
									onClick={() =>
										handleAction("requeue", () =>
											namespaceAuthedClient.workflowRun.transitionStateV1({
												type: "pessimistic",
												id: currentRun.id,
												state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
											})
										)
									}
								/>
							)}
							{canWake && (
								<ActionBtn
									label="Wake"
									color="var(--accent-indigo)"
									loading={actionLoading === "wake"}
									onClick={() =>
										handleAction("wake", () =>
											namespaceAuthedClient.workflowRun.transitionStateV1({
												type: "pessimistic",
												id: currentRun.id,
												state: { status: "scheduled", scheduledInMs: 0, reason: "wakeup_early" },
											})
										)
									}
								/>
							)}
							{canCancel && (
								<ActionBtn
									label="Cancel"
									color="var(--accent-red)"
									loading={actionLoading === "cancel"}
									onClick={() =>
										handleAction("cancel", () =>
											namespaceAuthedClient.workflowRun.transitionStateV1({
												type: "pessimistic",
												id: currentRun.id,
												state: { status: "cancelled" },
											})
										)
									}
								/>
							)}
						</div>
					)}
				</div>

				{/* Full ID */}
				<div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
					<span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t3)" }}>{currentRun.id}</span>
					<CopyButton text={currentRun.id} />
				</div>

				{/* Metadata row */}
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 20,
						alignItems: "flex-start",
						marginBottom: tasks.length > 0 ? 14 : 0,
					}}
				>
					<Meta label="Version">
						<span style={{ display: "inline-flex", alignItems: "center", minHeight: 22 }}>v{currentRun.versionId}</span>
					</Meta>

					{currentRun.referenceId && (
						<Meta label="Reference">
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 4,
									fontWeight: 700,
									maxWidth: 160,
								}}
								title={currentRun.referenceId}
							>
								<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{currentRun.referenceId}
								</span>
								<CopyButton text={currentRun.referenceId} />
							</span>
						</Meta>
					)}

					{currentRun.parentWorkflowRunId && (
						<Meta label="Parent">
							<span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-purple)" }}>
								{shortId(currentRun.parentWorkflowRunId)}
								<CopyButton text={currentRun.parentWorkflowRunId} />
							</span>
						</Meta>
					)}

					<Meta label="Attempts">{String(currentRun.attempts)}</Meta>

					<Meta label="Created">
						<RelativeTime timestamp={currentRun.createdAt} />
					</Meta>

					{/* Contextual: sleeping */}
					{currentRun.state.status === "sleeping" && (
						<Meta label="Awakes">
							<span style={{ color: "var(--accent-indigo)" }}>{timeUntil(currentRun.state.wakeupAt)}</span>
						</Meta>
					)}

					{/* Contextual: awaiting event */}
					{currentRun.state.status === "awaiting_event" && (
						<Meta label="Event">
							<span style={{ color: "var(--accent-pink)" }}>{currentRun.state.eventName}</span>
						</Meta>
					)}

					{/* Contextual: awaiting child workflow */}
					{currentRun.state.status === "awaiting_child_workflow" && (
						<Meta label="Waiting on">
							<span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-purple)" }}>
								{shortId(currentRun.state.childWorkflowRunId)}
								<CopyButton text={currentRun.state.childWorkflowRunId} />
							</span>
						</Meta>
					)}
				</div>

				{/* Task dots */}
				{tasks.length > 0 && (
					<div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
						{tasks.map((task) => (
							<StatusDot
								key={task.id}
								status={task.state.status as Parameters<typeof StatusDot>[0]["status"]}
								size={6}
							/>
						))}
						<span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 4 }}>
							{tasks.length} task{tasks.length !== 1 ? "s" : ""}
							{childRunCount > 0 && `, ${childRunCount} child run${childRunCount !== 1 ? "s" : ""}`}
						</span>
					</div>
				)}
			</div>

			{/* Action error */}
			{actionError && (
				<div
					style={{
						background: tint("var(--accent-red)"),
						border: `1px solid ${edge("var(--accent-red)")}`,
						borderRadius: "var(--r-panel)",
						padding: "11px 16px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: 14,
					}}
				>
					<span style={{ color: "var(--accent-red)", fontSize: 13 }}>{actionError}</span>
					<button
						type="button"
						onClick={() => setActionError(null)}
						style={{
							background: "none",
							border: "none",
							color: "var(--accent-red)",
							cursor: "pointer",
							padding: 0,
							display: "flex",
							alignItems: "center",
						}}
					>
						<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			)}

			{/* Pill-style tabs */}
			<div className="no-scrollbar" style={{ marginBottom: 12, maxWidth: "100%", overflowX: "auto" }}>
				<div
					style={{
						display: "inline-flex",
						flexWrap: "nowrap",
						background: "var(--s1)",
						border: "1px solid var(--b0)",
						borderRadius: "var(--r-card)",
						boxShadow: "var(--shadow-card)",
						padding: 3,
						gap: 2,
					}}
				>
					{(["execution", "timeline", "data"] as const).map((tab) => {
						const isActive = activeTab === tab;
						const label =
							tab === "execution" ? `Execution · ${executionCount}` : tab === "timeline" ? "Timeline" : "Data";
						return (
							<button
								key={tab}
								type="button"
								onClick={() => setActiveTab(tab)}
								style={{
									background: isActive ? "var(--accent-tint)" : "transparent",
									border: "none",
									borderRadius: "var(--r-chip)",
									color: isActive ? "var(--accent-ink)" : "var(--t3)",
									fontFamily: "var(--mono)",
									fontSize: 11.5,
									fontWeight: 500,
									letterSpacing: "0.02em",
									padding: "6px 14px",
									whiteSpace: "nowrap",
									cursor: "pointer",
									transition: "background .14s ease, color .14s ease",
								}}
							>
								{label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Tab content */}
			<div>
				{activeTab === "execution" && <ExecutionTab run={currentRun} scrollToTaskId={scrollToTaskId} />}
				{activeTab === "timeline" && (
					<TimelineTab
						transitions={transitions?.transitions ?? []}
						isLoading={transitionsLoading}
						lookups={timelineLookups}
					/>
				)}
				{activeTab === "data" && <DataTab run={currentRun} />}
			</div>
		</div>
	);
}

function RunDetailSkeleton() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<div style={{ height: 30, background: "var(--s2)", borderRadius: "var(--r-control)", width: 80 }} />
			<div style={{ ...card, padding: "22px 24px 20px" }}>
				<div
					style={{ height: 24, background: "var(--s2)", borderRadius: "var(--r-chip)", width: 200, marginBottom: 12 }}
				/>
				<div
					style={{ height: 14, background: "var(--s2)", borderRadius: "var(--r-chip)", width: 320, marginBottom: 16 }}
				/>
				<div style={{ display: "flex", gap: 20 }}>
					{["a", "b", "c", "d", "e"].map((key) => (
						<div key={key}>
							<div style={{ height: 10, background: "var(--s2)", borderRadius: 3, width: 40, marginBottom: 6 }} />
							<div style={{ height: 14, background: "var(--s2)", borderRadius: "var(--r-chip)", width: 70 }} />
						</div>
					))}
				</div>
			</div>
			<div style={{ ...card, height: 36, width: 260 }} />
			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				{["a", "b", "c"].map((key) => (
					<div key={key} style={{ height: 48, background: "var(--s2)", borderRadius: 8 }} />
				))}
			</div>
		</div>
	);
}
