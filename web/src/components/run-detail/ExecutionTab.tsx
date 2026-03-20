import type { EventWaitQueue } from "@aikirun/types/event";
import type { SleepQueue } from "@aikirun/types/sleep";
import type { TaskInfo } from "@aikirun/types/task";
import type {
	ChildWorkflowRunInfo,
	ChildWorkflowRunWaitCompleted,
	TerminalWorkflowRunStatus,
	WorkflowRun,
} from "@aikirun/types/workflow-run";
import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { TASK_STATUS_COLORS, TASK_STATUS_GLYPHS, WORKFLOW_RUN_STATUS_COLORS } from "../../constants/status-colors";
import { CopyButton } from "../common/CopyButton";
import { StatusBadge } from "../common/StatusBadge";

interface ExecutionTabProps {
	run: WorkflowRun;
	scrollToTaskId?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortId(id: string): string {
	return id.length > 10 ? id.slice(-6) : id;
}

function fmtTime(ts: number): string {
	return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeUntil(ts: number): string {
	const d = ts - Date.now();
	if (d <= 0) return "now";
	if (d < 60_000) return `${Math.floor(d / 1000)}s`;
	if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
	return `${Math.floor(d / 3_600_000)}h`;
}

function ChevronIcon({ open }: { open: boolean }) {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 14 14"
			fill="none"
			stroke="var(--t3)"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ flexShrink: 0, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }}
		>
			<polyline points="3.5 5 7 8.5 10.5 5" />
		</svg>
	);
}

// ── Root component ────────────────────────────────────────────────────────────

export function ExecutionTab({ run, scrollToTaskId }: ExecutionTabProps) {
	const tasks = Object.values(run.taskQueues).flatMap((q) => q.tasks);
	const childWorkflows = Object.values(run.childWorkflowRunQueues).flatMap((q) => q.childWorkflowRuns);
	const sleepEntries = Object.entries(run.sleepQueues);
	const eventEntries = Object.entries(run.eventWaitQueues);

	const awaitingChildId = run.state.status === "awaiting_child_workflow" ? run.state.childWorkflowRunId : undefined;

	const hasContent =
		tasks.length > 0 ||
		childWorkflows.length > 0 ||
		sleepEntries.length > 0 ||
		eventEntries.length > 0 ||
		run.state.status === "failed";

	if (!hasContent) {
		return <div style={{ padding: 36, textAlign: "center", color: "var(--t3)", fontSize: 13 }}>No execution data</div>;
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
			{tasks.length > 0 && (
				<>
					<SectionHeader label="Tasks" />
					{tasks.map((task) => (
						<TaskCard key={task.id} task={task} scrollTo={scrollToTaskId === task.id} />
					))}
				</>
			)}

			{childWorkflows.length > 0 && (
				<>
					<SectionHeader label="Child Workflows" />
					{childWorkflows.map((child) => (
						<ChildWorkflowCard key={child.id} child={child} isAwaited={child.id === awaitingChildId} />
					))}
				</>
			)}

			{sleepEntries.length > 0 && (
				<>
					<SectionHeader label="Sleeps" />
					{sleepEntries.map(([name, queue]) => (
						<SleepRow key={name} name={name} queue={queue} />
					))}
				</>
			)}

			{eventEntries.length > 0 && (
				<>
					<SectionHeader label="Events" />
					{eventEntries.map(([name, queue]) => (
						<EventRow
							key={name}
							name={name}
							queue={queue}
							isWaiting={run.state.status === "awaiting_event" && run.state.eventName === name}
							timeoutAt={run.state.status === "awaiting_event" ? run.state.timeoutAt : undefined}
						/>
					))}
				</>
			)}

			{run.state.status === "failed" && <ErrorBlock state={run.state} />}
		</div>
	);
}

function SectionHeader({ label }: { label: string }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 2 }}>
			<span
				style={{
					fontSize: 10,
					fontWeight: 700,
					color: "var(--t3)",
					textTransform: "uppercase",
					letterSpacing: ".07em",
				}}
			>
				{label}
			</span>
			<div style={{ flex: 1, height: 1, background: "var(--b0)" }} />
		</div>
	);
}

// ── Task card ─────────────────────────────────────────────────────────────────

function taskHasExpandableData(task: TaskInfo): boolean {
	const s = task.state;
	if (s.status === "completed") return s.output !== undefined;
	if (s.status === "failed" || s.status === "awaiting_retry") return true;
	if (s.status === "running") return s.input !== undefined;
	return false;
}

const TaskCard = memo(function TaskCard({ task, scrollTo }: { task: TaskInfo; scrollTo: boolean }) {
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const colorEntry = TASK_STATUS_COLORS[task.state.status];
	const color = colorEntry.tint;
	const textColor = colorEntry.text;
	const glyph = TASK_STATUS_GLYPHS[task.state.status];
	const attempts = task.state.attempts;
	const canExpand = taskHasExpandableData(task);

	useEffect(() => {
		if (scrollTo && ref.current && canExpand) {
			ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
			setIsOpen(true);
		}
	}, [scrollTo, canExpand]);

	return (
		<div ref={ref} id={`task-${task.id}`} style={{ scrollMarginTop: 16 }}>
			<div
				{...(canExpand
					? {
							role: "button",
							tabIndex: 0,
							onClick: () => setIsOpen(!isOpen),
							onKeyDown: (e: React.KeyboardEvent) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setIsOpen(!isOpen);
								}
							},
						}
					: {})}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "9px 14px",
					background: "var(--s1)",
					border: "1px solid var(--b0)",
					borderRadius: isOpen ? "8px 8px 0 0" : 8,
					cursor: canExpand ? "pointer" : "default",
					transition: "all .12s",
				}}
			>
				<div
					className={task.state.status === "running" ? "anim-blink" : undefined}
					style={{
						width: 24,
						height: 24,
						borderRadius: "50%",
						background: `${color}30`,
						border: `1.5px solid ${color}50`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 10,
						color: textColor,
						flexShrink: 0,
					}}
				>
					{glyph}
				</div>

				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: "var(--t0)" }}>
							{task.name}
						</span>
						{attempts > 1 && (
							<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accent-orange)" }}>
								×{attempts}
							</span>
						)}
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)" }}>{shortId(task.id)}</span>
						<CopyButton text={task.id} />
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)" }}>
							· {shortId(task.inputHash)}
						</span>
						<CopyButton text={task.inputHash} />
					</div>
				</div>

				{canExpand && <ChevronIcon open={isOpen} />}
			</div>

			{isOpen && canExpand && (
				<div
					style={{
						background: "var(--s2)",
						border: "1px solid var(--b0)",
						borderTop: "none",
						borderRadius: "0 0 8px 8px",
						padding: "10px 14px",
					}}
				>
					<TaskOutput task={task} color={color} />
				</div>
			)}
		</div>
	);
});

function TaskOutput({ task, color }: { task: TaskInfo; color: string }) {
	const state = task.state;
	let text: string;
	if (state.status === "completed") {
		text = state.output !== undefined ? JSON.stringify(state.output, null, 2) : "(no output)";
	} else if (state.status === "failed") {
		text = state.error.message || "Unknown error";
	} else if (state.status === "running") {
		text = state.input !== undefined ? JSON.stringify(state.input, null, 2) : "Executing…";
	} else {
		text = `Error: ${state.error.message}\nRetrying…`;
	}

	return (
		<pre
			style={{
				fontFamily: "var(--mono)",
				fontSize: 11,
				lineHeight: 1.6,
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				color,
				margin: 0,
			}}
		>
			{text}
		</pre>
	);
}

// ── Child workflows ───────────────────────────────────────────────────────────

function resolveChildStatus(child: ChildWorkflowRunInfo): {
	status: TerminalWorkflowRunStatus | "running";
	resolvedWait: ChildWorkflowRunWaitCompleted | null;
} {
	const waitQueues = child.childWorkflowRunWaitQueues;
	for (const terminalStatus of ["completed", "failed", "cancelled"] as const) {
		const queue = waitQueues[terminalStatus];
		const wait = queue?.childWorkflowRunWaits[0];
		if (wait?.status === "completed") {
			return { status: terminalStatus, resolvedWait: wait };
		}
	}
	return { status: "running", resolvedWait: null };
}

function childStatusColor(status: TerminalWorkflowRunStatus | "running"): { tint: string; text: string } {
	if (status === "completed") return WORKFLOW_RUN_STATUS_COLORS.completed;
	if (status === "failed") return WORKFLOW_RUN_STATUS_COLORS.failed;
	if (status === "cancelled") return WORKFLOW_RUN_STATUS_COLORS.cancelled;
	return WORKFLOW_RUN_STATUS_COLORS.running;
}

function childStatusGlyph(status: TerminalWorkflowRunStatus | "running"): string {
	if (status === "completed") return "✓";
	if (status === "failed") return "✕";
	if (status === "cancelled") return "⊘";
	return "⑂";
}

function ChildWorkflowCard({ child, isAwaited }: { child: ChildWorkflowRunInfo; isAwaited: boolean }) {
	const { status, resolvedWait } = resolveChildStatus(child);
	const { tint: color, text: textColor } = childStatusColor(status);
	const glyph = childStatusGlyph(status);
	const hasResolvedOutput = resolvedWait !== null;
	const [isOpen, setIsOpen] = useState(false);

	return (
		<div
			style={{
				background: isAwaited ? "rgba(192,132,252,0.04)" : "var(--s1)",
				border: `1px solid ${isAwaited ? "rgba(192,132,252,0.2)" : "var(--b0)"}`,
				borderRadius: 8,
				overflow: "hidden",
			}}
		>
			{/* Header row — clickable to expand */}
			<div
				{...(hasResolvedOutput
					? {
							role: "button",
							tabIndex: 0,
							onClick: () => setIsOpen(!isOpen),
							onKeyDown: (e: React.KeyboardEvent) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setIsOpen(!isOpen);
								}
							},
						}
					: {})}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "10px 14px",
					minWidth: 0,
					cursor: hasResolvedOutput ? "pointer" : "default",
				}}
			>
				<div
					className={status === "running" ? "anim-blink" : undefined}
					style={{
						width: 24,
						height: 24,
						borderRadius: "50%",
						background: `${color}30`,
						border: `1.5px solid ${color}50`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 10,
						color: textColor,
						flexShrink: 0,
					}}
				>
					{glyph}
				</div>

				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
						<span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: "var(--t0)" }}>
							{child.name}
						</span>
						<span
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10,
								color: "var(--t3)",
								background: "var(--s3)",
								padding: "1px 5px",
								borderRadius: 4,
							}}
						>
							v{child.versionId}
						</span>
						{isAwaited && (
							<span
								style={{
									fontSize: 9,
									fontWeight: 600,
									color: "#C084FC",
									background: "rgba(192,132,252,0.1)",
									border: "1px solid rgba(192,132,252,0.2)",
									padding: "1px 6px",
									borderRadius: 999,
								}}
							>
								awaiting
							</span>
						)}
						{resolvedWait && <StatusBadge status={status as TerminalWorkflowRunStatus} size="sm" />}
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)" }}>{shortId(child.id)}</span>
						<CopyButton text={child.id} />
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)" }}>
							· {shortId(child.inputHash)}
						</span>
						<CopyButton text={child.inputHash} />
					</div>
				</div>

				<Link
					to={`/runs/${child.id}`}
					onClick={(e) => e.stopPropagation()}
					style={{
						background: "rgba(56,189,248,0.12)",
						border: "1px solid rgba(56,189,248,0.35)",
						color: "var(--accent-sky)",
						fontSize: 11,
						fontWeight: 600,
						padding: "4px 10px",
						borderRadius: 6,
						textDecoration: "none",
						whiteSpace: "nowrap",
						flexShrink: 0,
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
					}}
				>
					View run →
				</Link>

				{hasResolvedOutput && <ChevronIcon open={isOpen} />}
			</div>

			{/* Collapsed resolved output */}
			{isOpen && hasResolvedOutput && (
				<div style={{ padding: "0 14px 10px 48px", overflow: "hidden" }}>
					<ChildWorkflowResolvedPre wait={resolvedWait} />
				</div>
			)}
		</div>
	);
}

function ChildWorkflowResolvedPre({ wait }: { wait: ChildWorkflowRunWaitCompleted }) {
	const childState = wait.childWorkflowRunState;

	if (childState.status === "completed" && childState.output !== undefined) {
		return (
			<pre
				style={{
					fontFamily: "var(--mono)",
					fontSize: 10,
					color: "#34D399",
					opacity: 0.7,
					lineHeight: 1.4,
					margin: 0,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					overflowWrap: "anywhere",
				}}
			>
				{JSON.stringify(childState.output, null, 2)}
			</pre>
		);
	}

	if (childState.status === "failed" && childState.cause === "self") {
		return (
			<pre
				style={{
					fontFamily: "var(--mono)",
					fontSize: 10,
					color: "#F87171",
					opacity: 0.7,
					lineHeight: 1.4,
					margin: 0,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					overflowWrap: "anywhere",
				}}
			>
				{childState.error.message}
			</pre>
		);
	}

	return null;
}

// ── Sleeps ────────────────────────────────────────────────────────────────────

function SleepRow({ name, queue }: { name: string; queue: SleepQueue }) {
	const activeSleep = queue.sleeps.find((s) => s.status === "sleeping");
	const awakeAt = activeSleep?.status === "sleeping" ? activeSleep.awakeAt : undefined;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "10px 14px",
				background: "var(--s1)",
				border: "1px solid var(--b0)",
				borderRadius: 8,
			}}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 16 16"
				fill="none"
				stroke="#818CF8"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{ flexShrink: 0 }}
			>
				<path d="M4 2h8M4 14h8M5 2v2.5a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2M5 14v-2.5a3 3 0 0 1 3-3 3 3 0 0 1 3 3V14" />
			</svg>
			<span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: "var(--t0)" }}>{name}</span>
			<span style={{ flex: 1 }} />
			{awakeAt !== undefined && <SleepCountdown awakeAt={awakeAt} />}
		</div>
	);
}

function SleepCountdown({ awakeAt }: { awakeAt: number }) {
	const [remaining, setRemaining] = useState(() => timeUntil(awakeAt));
	useEffect(() => {
		const interval = setInterval(() => setRemaining(timeUntil(awakeAt)), 1000);
		return () => clearInterval(interval);
	}, [awakeAt]);
	return <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#818CF8" }}>{remaining}</span>;
}

// ── Events ────────────────────────────────────────────────────────────────────

function EventRow({
	name,
	queue,
	isWaiting,
	timeoutAt,
}: {
	name: string;
	queue: EventWaitQueue<unknown>;
	isWaiting: boolean;
	timeoutAt?: number;
}) {
	const waits = queue.eventWaits;
	const hasWaits = waits.length > 0;
	const [isOpen, setIsOpen] = useState(false);

	return (
		<div>
			{/* Header card — clickable */}
			<div
				{...(hasWaits
					? {
							role: "button",
							tabIndex: 0,
							onClick: () => setIsOpen(!isOpen),
							onKeyDown: (e: React.KeyboardEvent) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setIsOpen(!isOpen);
								}
							},
						}
					: {})}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "10px 14px",
					background: isWaiting ? "rgba(244,114,182,0.04)" : "var(--s1)",
					border: `1px solid ${isWaiting ? "rgba(244,114,182,0.2)" : "var(--b0)"}`,
					borderRadius: isOpen ? "8px 8px 0 0" : 8,
					cursor: hasWaits ? "pointer" : "default",
					transition: "all .12s",
				}}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					stroke="#F472B6"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ flexShrink: 0 }}
				>
					<path d="M8 1.5v1M8 13a1.5 1.5 0 0 1-1.5 1.5h3A1.5 1.5 0 0 1 8 13Zm0 0V12M12 7c0-2.2-1.8-4-4-4S4 4.8 4 7c0 2.5-1.5 4-2 5h12c-.5-1-2-2.5-2-5Z" />
				</svg>
				<span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: "var(--t0)" }}>{name}</span>
				{isWaiting && (
					<span
						style={{
							fontSize: 9,
							fontWeight: 600,
							color: "#F472B6",
							background: "rgba(244,114,182,0.1)",
							border: "1px solid rgba(244,114,182,0.2)",
							padding: "1px 6px",
							borderRadius: 999,
						}}
					>
						waiting
					</span>
				)}
				<span style={{ flex: 1 }} />
				{isWaiting && timeoutAt !== undefined && <EventTimeoutCountdown timeoutAt={timeoutAt} />}
				{hasWaits && (
					<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--t3)" }}>{waits.length} received</span>
				)}
				{hasWaits && <ChevronIcon open={isOpen} />}
			</div>

			{/* Expanded waits */}
			{isOpen && hasWaits && (
				<div
					style={{
						background: "var(--s2)",
						border: "1px solid var(--b0)",
						borderTop: "none",
						borderRadius: "0 0 8px 8px",
						padding: "8px 14px",
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}
				>
					{waits.map((wait) => (
						<EventWaitRow
							key={wait.status === "received" ? `r-${wait.receivedAt}` : `t-${wait.timedOutAt}`}
							wait={wait}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function EventTimeoutCountdown({ timeoutAt }: { timeoutAt: number }) {
	const [label, setLabel] = useState(() => timeUntil(timeoutAt));
	useEffect(() => {
		const interval = setInterval(() => setLabel(timeUntil(timeoutAt)), 1000);
		return () => clearInterval(interval);
	}, [timeoutAt]);
	return <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#F472B6" }}>timeout {label}</span>;
}

function EventWaitRow({ wait }: { wait: EventWaitQueue<unknown>["eventWaits"][number] }) {
	const isReceived = wait.status === "received";
	const color = isReceived ? "#34D399" : "#FB923C";

	return (
		<div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
			<span style={{ color, fontSize: 10, marginTop: 2 }}>{isReceived ? "✓" : "⏱"}</span>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
					<span style={{ fontSize: 10.5, fontWeight: 600, color }}>{isReceived ? "Received" : "Timed out"}</span>
					<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--t3)" }}>
						{isReceived ? fmtTime(wait.receivedAt) : fmtTime(wait.timedOutAt)}
					</span>
					{isReceived && wait.reference?.id && (
						<span style={{ display: "flex", alignItems: "center", gap: 2 }}>
							<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)" }}>
								ref:{shortId(wait.reference.id)}
							</span>
							<CopyButton text={wait.reference.id} />
						</span>
					)}
				</div>
				{isReceived && wait.data !== undefined && (
					<pre
						style={{
							fontFamily: "var(--mono)",
							fontSize: 10.5,
							color: "var(--t1)",
							lineHeight: 1.5,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							margin: 0,
						}}
					>
						{JSON.stringify(wait.data, null, 2)}
					</pre>
				)}
			</div>
		</div>
	);
}

// ── Error block ───────────────────────────────────────────────────────────────

type FailedState = Extract<WorkflowRun["state"], { status: "failed" }>;

function ErrorBlock({ state }: { state: FailedState }) {
	const error = state.cause === "self" ? state.error : undefined;

	return (
		<div
			style={{
				padding: "14px 16px",
				background: "rgba(248,113,113,0.04)",
				border: "1px solid rgba(248,113,113,0.12)",
				borderRadius: 8,
				marginTop: 4,
				minWidth: 0,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					fontSize: 12,
					fontWeight: 700,
					color: "#F87171",
					marginBottom: 6,
					display: "flex",
					alignItems: "center",
					gap: 6,
				}}
			>
				✕ Error
				<span
					style={{
						fontSize: 10,
						fontWeight: 500,
						color: "var(--t3)",
						background: "var(--s3)",
						padding: "1px 6px",
						borderRadius: 4,
					}}
				>
					{state.cause}
				</span>
			</div>

			{state.cause === "task" && (
				<pre
					style={{
						fontFamily: "var(--mono)",
						fontSize: 11,
						color: "#FCA5A5",
						lineHeight: 1.6,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						margin: 0,
					}}
				>
					Task {shortId(state.taskId)} failed
				</pre>
			)}

			{state.cause === "child_workflow" && (
				<pre
					style={{
						fontFamily: "var(--mono)",
						fontSize: 11,
						color: "#FCA5A5",
						lineHeight: 1.6,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						margin: 0,
					}}
				>
					Child workflow{" "}
					<Link to={`/runs/${state.childWorkflowRunId}`} style={{ color: "var(--accent-purple)" }}>
						{shortId(state.childWorkflowRunId)}
					</Link>{" "}
					failed
				</pre>
			)}

			{error && (
				<>
					<pre
						style={{
							fontFamily: "var(--mono)",
							fontSize: 11,
							color: "#FCA5A5",
							lineHeight: 1.6,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							margin: 0,
						}}
					>
						{error.message}
					</pre>
					{error.stack && (
						<pre
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10,
								color: "var(--t3)",
								lineHeight: 1.5,
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								margin: "6px 0 0",
								opacity: 0.6,
							}}
						>
							{error.stack}
						</pre>
					)}
				</>
			)}
		</div>
	);
}
