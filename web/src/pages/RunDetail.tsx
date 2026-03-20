import type { ChildWorkflowRunInfo } from "@aikirun/types/workflow-run";
import { isTerminalWorkflowRunStatus } from "@aikirun/types/workflow-run";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { client } from "../api/client";
import { useWorkflowRun, useWorkflowRunTransitions } from "../api/hooks";
import { CopyButton } from "../components/common/CopyButton";
import { SpinnerIcon } from "../components/common/Icons";
import { NotFound } from "../components/common/NotFound";
import { RelativeTime } from "../components/common/RelativeTime";
import { StatusBadge, StatusDot } from "../components/common/StatusBadge";
import { DataTab } from "../components/run-detail/DataTab";
import { ExecutionTab } from "../components/run-detail/ExecutionTab";
import { TimelineTab } from "../components/run-detail/TimelineTab";
import { buildTimelineLookups } from "../components/run-detail/timeline-lookups";
import { WORKFLOW_RUN_STATUS_COLORS } from "../constants/status-colors";

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
	textColor,
	onClick,
	loading,
}: {
	label: string;
	color: string;
	textColor?: string;
	onClick: () => void;
	loading?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={loading}
			style={{
				background: `${color}30`,
				border: `1px solid ${color}50`,
				color: textColor ?? color,
				fontSize: 11.5,
				fontWeight: 600,
				padding: "5px 13px",
				borderRadius: 7,
				cursor: loading ? "not-allowed" : "pointer",
				opacity: loading ? 0.5 : 1,
				fontFamily: "inherit",
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
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
			<div
				style={{
					fontSize: 9,
					fontWeight: 600,
					letterSpacing: "0.07em",
					color: "var(--t3)",
					textTransform: "uppercase",
					marginBottom: 3,
				}}
			>
				{label}
			</div>
			<div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 500, color: "var(--t0)", lineHeight: "22px" }}>
				{children}
			</div>
		</div>
	);
}

export function RunDetail() {
	const { id } = useParams<{ id: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
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
		for (const queue of Object.values(currentRun.childWorkflowRunQueues)) {
			for (const child of queue.childWorkflowRuns) {
				result[child.id] = child;
			}
		}
		return result;
	}, [currentRun]);

	const tasks = useMemo(
		() => (currentRun ? Object.values(currentRun.taskQueues).flatMap((q) => q.tasks) : []),
		[currentRun]
	);

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
			currentRun.eventWaitQueues,
			currentRun.sleepQueues,
			childWorkflowRuns,
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
	const statusColor = WORKFLOW_RUN_STATUS_COLORS[status].tint;
	const isTerminal = isTerminalWorkflowRunStatus(status);
	const canCancel = !isTerminal;
	const canPause = ["scheduled", "queued", "running"].includes(status);
	const canResume = status === "paused";

	const executionCount = tasks.length + childRunCount;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
			{/* Nav bar */}
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
				<Link
					to="/"
					style={{
						background: "var(--s2)",
						border: "1px solid var(--b0)",
						color: "var(--t2)",
						fontSize: 12,
						fontWeight: 600,
						padding: "5px 12px",
						borderRadius: 7,
						textDecoration: "none",
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						fontFamily: "inherit",
					}}
				>
					← Runs
				</Link>
				{currentRun.parentWorkflowRunId && (
					<Link
						to={`/runs/${currentRun.parentWorkflowRunId}`}
						style={{
							background: "rgba(192,132,252,0.18)",
							border: "1px solid rgba(192,132,252,0.4)",
							color: "var(--accent-purple)",
							fontSize: 11,
							fontWeight: 600,
							padding: "5px 12px",
							borderRadius: 7,
							textDecoration: "none",
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							fontFamily: "inherit",
						}}
					>
						↑ Parent run {shortId(currentRun.parentWorkflowRunId)}
					</Link>
				)}
				{currentRun.scheduleId && (
					<Link
						to={`/schedules?id=${currentRun.scheduleId}`}
						style={{
							background: "rgba(56,189,248,0.18)",
							border: "1px solid rgba(56,189,248,0.4)",
							color: "var(--accent-sky)",
							fontSize: 11,
							fontWeight: 600,
							padding: "5px 12px",
							borderRadius: 7,
							textDecoration: "none",
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							fontFamily: "inherit",
						}}
					>
						⏱ Schedule {shortId(currentRun.scheduleId)}
					</Link>
				)}
			</div>

			{/* Hero card */}
			<div
				style={{
					background: "var(--s1)",
					border: "1px solid var(--b0)",
					borderRadius: 12,
					padding: "20px 22px 18px",
					marginBottom: 14,
					borderTop: `2px solid ${statusColor}40`,
				}}
			>
				{/* Top row: name + pill + actions */}
				<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
						<span
							style={{
								fontSize: 20,
								fontWeight: 800,
								color: "var(--t0)",
								letterSpacing: "-0.03em",
							}}
						>
							{currentRun.name}
						</span>
						<StatusBadge status={status} size="md" />
						{currentRun.parentWorkflowRunId && (
							<span
								style={{
									fontSize: 10,
									fontWeight: 600,
									color: "var(--accent-purple)",
									background: "rgba(192,132,252,0.18)",
									border: "1px solid rgba(192,132,252,0.3)",
									padding: "2px 8px",
									borderRadius: 999,
								}}
							>
								child
							</span>
						)}
					</div>

					{/* Action buttons — only shown for non-terminal runs */}
					{!isTerminal && (
						<div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
							{canResume && (
								<ActionBtn
									label="Resume"
									color="#34D399"
									textColor="var(--accent-green)"
									loading={actionLoading === "resume"}
									onClick={() =>
										handleAction("resume", () =>
											client.workflowRun.transitionStateV1({
												type: "pessimistic",
												id: currentRun.id,
												state: { status: "scheduled", scheduledInMs: 0, reason: "resume" },
											})
										)
									}
								/>
							)}
							{canPause && (
								<ActionBtn
									label="Pause"
									color="#FBBF24"
									textColor="var(--accent-amber)"
									loading={actionLoading === "pause"}
									onClick={() =>
										handleAction("pause", () =>
											client.workflowRun.transitionStateV1({
												type: "pessimistic",
												id: currentRun.id,
												state: { status: "paused" },
											})
										)
									}
								/>
							)}
							{canCancel && (
								<ActionBtn
									label="Cancel"
									color="#F87171"
									textColor="var(--accent-red)"
									loading={actionLoading === "cancel"}
									onClick={() =>
										handleAction("cancel", () =>
											client.workflowRun.transitionStateV1({
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
					<span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--t3)" }}>{currentRun.id}</span>
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

					{currentRun.options?.reference && (
						<Meta label="Reference">
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 4,
									fontWeight: 700,
									maxWidth: 160,
								}}
								title={currentRun.options.reference.id}
							>
								<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{currentRun.options.reference.id}
								</span>
								<CopyButton text={currentRun.options.reference.id} />
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
							<span style={{ color: "var(--accent-indigo)" }}>{timeUntil(currentRun.state.awakeAt)}</span>
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
						background: "#F8717110",
						border: "1px solid #F8717130",
						borderRadius: 8,
						padding: "10px 16px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: 14,
					}}
				>
					<span style={{ color: "#F87171", fontSize: 13 }}>{actionError}</span>
					<button
						type="button"
						onClick={() => setActionError(null)}
						style={{
							background: "none",
							border: "none",
							color: "#F87171",
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
			<div style={{ marginBottom: 12 }}>
				<div
					style={{
						display: "inline-flex",
						background: "var(--s1)",
						border: "1px solid var(--b0)",
						borderRadius: 8,
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
									background: isActive ? "var(--s3)" : "transparent",
									border: "none",
									borderRadius: 6,
									color: isActive ? "var(--t0)" : "var(--t3)",
									fontSize: 12,
									fontWeight: 600,
									padding: "5px 13px",
									cursor: "pointer",
									fontFamily: "inherit",
									transition: "background 0.1s, color 0.1s",
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
			<div style={{ height: 30, background: "var(--s2)", borderRadius: 7, width: 80 }} />
			<div
				style={{
					background: "var(--s1)",
					border: "1px solid var(--b0)",
					borderRadius: 12,
					padding: "20px 22px 18px",
				}}
			>
				<div style={{ height: 24, background: "var(--s2)", borderRadius: 6, width: 200, marginBottom: 12 }} />
				<div style={{ height: 14, background: "var(--s2)", borderRadius: 4, width: 320, marginBottom: 16 }} />
				<div style={{ display: "flex", gap: 20 }}>
					{["a", "b", "c", "d", "e"].map((key) => (
						<div key={key}>
							<div style={{ height: 10, background: "var(--s2)", borderRadius: 3, width: 40, marginBottom: 6 }} />
							<div style={{ height: 14, background: "var(--s2)", borderRadius: 4, width: 70 }} />
						</div>
					))}
				</div>
			</div>
			<div
				style={{ height: 36, background: "var(--s1)", borderRadius: 8, width: 260, border: "1px solid var(--b0)" }}
			/>
			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				{["a", "b", "c"].map((key) => (
					<div key={key} style={{ height: 48, background: "var(--s2)", borderRadius: 8 }} />
				))}
			</div>
		</div>
	);
}
