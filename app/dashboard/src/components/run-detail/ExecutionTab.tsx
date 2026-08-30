import type {
	ChildWorkflowRunInfo,
	ChildWorkflowRunWaits,
	EventWait,
	Sleep,
	TerminalWorkflowRunStatus,
	WorkflowRunRecord,
} from "@aikirun/types/workflow/run";
import type { TaskInfo } from "@aikirun/types/workflow/task";
import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useTask } from "../../api/hooks";
import {
	edge,
	TASK_STATUS_COLORS,
	TASK_STATUS_GLYPHS,
	tint,
	WORKFLOW_RUN_STATUS_COLORS,
} from "../../constants/status-colors";
import { CopyButton } from "../common/CopyButton";
import { DataBlock } from "../common/DataBlock";
import { StatusBadge } from "../common/StatusBadge";
import { chipNeutral, chipStatus, eyebrow } from "../common/ui";

interface ExecutionTabProps {
	run: WorkflowRunRecord;
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
	const tasks = Object.values(run.tasks).flat();
	const childWorkflows = Object.values(run.childWorkflowRuns).flat();
	const sleepEntries = Object.entries(run.sleeps);
	const eventEntries = Object.entries(run.eventWaits);

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
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
						<ChildWorkflowCard
							key={child.id}
							child={child}
							waits={run.childWorkflowRunWaits[child.id]}
							isAwaited={child.id === awaitingChildId}
						/>
					))}
				</>
			)}

			{sleepEntries.length > 0 && (
				<>
					<SectionHeader label="Sleeps" />
					{sleepEntries.map(([name, sleeps]) => (
						<SleepRow key={name} name={name} sleeps={sleeps} />
					))}
				</>
			)}

			{eventEntries.length > 0 && (
				<>
					<SectionHeader label="Events" />
					{eventEntries.map(([name, waits]) => (
						<EventRow
							key={name}
							name={name}
							waits={waits}
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
		<div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, marginBottom: 6 }}>
			<span style={eyebrow()}>{label}</span>
			<div style={{ flex: 1, height: 1, background: "var(--b0)" }} />
		</div>
	);
}

// ── Task card ─────────────────────────────────────────────────────────────────

const TaskCard = memo(function TaskCard({ task, scrollTo }: { task: TaskInfo; scrollTo: boolean }) {
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const color = TASK_STATUS_COLORS[task.state.status];
	const glyph = TASK_STATUS_GLYPHS[task.state.status];
	const attempts = task.attempts;

	useEffect(() => {
		if (scrollTo && ref.current) {
			ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
			setIsOpen(true);
		}
	}, [scrollTo]);

	return (
		<div ref={ref} id={`task-${task.id}`} style={{ scrollMarginTop: 16 }}>
			{/* The task name is the toggle; the copy buttons sit beside it, not inside it. */}
			<div
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "11px 16px",
					background: "var(--s1)",
					border: "1px solid var(--b0)",
					borderRadius: isOpen ? "var(--r-card) var(--r-card) 0 0" : "var(--r-card)",
					boxShadow: isOpen ? "none" : "var(--shadow-card)",
					cursor: "pointer",
					transition: "background-color .16s ease, border-color .16s ease",
				}}
			>
				<div
					className={task.state.status === "running" ? "anim-blink" : undefined}
					style={{
						width: 24,
						height: 24,
						borderRadius: "50%",
						background: tint(color),
						border: `1.5px solid ${edge(color)}`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 10,
						color,
						flexShrink: 0,
					}}
				>
					{glyph}
				</div>

				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<button
							type="button"
							className="row-target"
							aria-expanded={isOpen}
							onClick={() => setIsOpen(!isOpen)}
							style={{
								background: "none",
								border: "none",
								padding: 0,
								cursor: "pointer",
								fontFamily: "var(--mono)",
								fontSize: 12,
								fontWeight: 600,
								color: "var(--t0)",
								textAlign: "left",
							}}
						>
							{task.name}
						</button>
						{attempts > 1 && (
							<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accent-orange)" }}>
								×{attempts}
							</span>
						)}
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)" }}>
							<span style={{ opacity: 0.62 }}>ID</span> {shortId(task.id)}
						</span>
						<CopyButton text={task.id} />
						<span style={{ fontSize: 9.5, color: "var(--b0)", marginLeft: -2, marginRight: 2 }}>•</span>
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)" }}>
							<span style={{ opacity: 0.62 }}>HASH</span> {shortId(task.inputHash)}
						</span>
						<CopyButton text={task.inputHash} />
					</div>
				</div>

				<ChevronIcon open={isOpen} />
			</div>

			{isOpen && (
				<div
					style={{
						background: "var(--s1)",
						border: "1px solid var(--b0)",
						borderTop: "none",
						borderRadius: "0 0 var(--r-card) var(--r-card)",
						boxShadow: "var(--shadow-card)",
						padding: "4px 16px 16px",
					}}
				>
					<TaskDetail task={task} color={color} />
				</div>
			)}
		</div>
	);
});

// Task payloads are not part of the run record; the full detail is fetched per
// task when the card is opened.
function TaskDetail({ task, color }: { task: TaskInfo; color: string }) {
	const { data, isPending, isError } = useTask(task);

	if (isPending) {
		return <TaskText color={color} text="Loading…" />;
	}
	if (isError || !data) {
		return <TaskText color={color} text="Failed to load task" />;
	}

	const { input, options, state } = data.task;

	let outcome: { label: string; text: string } | undefined;
	if (state.status === "completed") {
		outcome = {
			label: "Output",
			text: state.output !== undefined ? JSON.stringify(state.output, null, 2) : "(no output)",
		};
	} else if (state.status === "failed") {
		outcome = { label: "Error", text: state.error.message || "Unknown error" };
	} else if (state.status === "awaiting_retry") {
		outcome = { label: "Error", text: `${state.error.message}\nRetrying…` };
	} else {
		state.status satisfies "running" | "discarded";
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<DataBlock label="Input" text={input !== undefined ? JSON.stringify(input, null, 2) : "(no input)"} />
			{outcome && (
				<DataBlock
					label={outcome.label}
					text={outcome.text}
					tone={state.status === "completed" ? "var(--on-code-green)" : "var(--on-code-red)"}
				/>
			)}
			{options && <DataBlock label="Options" text={JSON.stringify(options, null, 2)} />}
		</div>
	);
}

function TaskText({ text, color }: { text: string; color: string }) {
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

function resolveChildStatus(waits: ChildWorkflowRunWaits | undefined): {
	status: TerminalWorkflowRunStatus | "running";
	resolvedWait: TerminalChildWait | null;
} {
	const terminal = waits?.terminal;
	if (terminal) {
		return { status: terminal.state.status, resolvedWait: terminal };
	}
	return { status: "running", resolvedWait: null };
}

function childStatusColor(status: TerminalWorkflowRunStatus | "running"): string {
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

function ChildWorkflowCard({
	child,
	waits,
	isAwaited,
}: {
	child: ChildWorkflowRunInfo;
	waits: ChildWorkflowRunWaits | undefined;
	isAwaited: boolean;
}) {
	const { status, resolvedWait } = resolveChildStatus(waits);
	const color = childStatusColor(status);
	const glyph = childStatusGlyph(status);
	const hasResolvedOutput = resolvedWait !== null;
	const [isOpen, setIsOpen] = useState(false);

	return (
		<div
			style={{
				background: isAwaited ? tint("var(--accent-purple)") : "var(--s1)",
				border: `1px solid ${isAwaited ? edge("var(--accent-purple)") : "var(--b0)"}`,
				borderRadius: "var(--r-card)",
				boxShadow: "var(--shadow-card)",
				overflow: "hidden",
			}}
		>
			{/* Header row — the child's name expands it when there is output to show */}
			<div
				style={{
					position: "relative",
					display: "flex",
					alignItems: "flex-start",
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
						background: tint(color),
						border: `1.5px solid ${edge(color)}`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 10,
						color,
						flexShrink: 0,
					}}
				>
					{glyph}
				</div>

				<div style={{ flex: "1 1 auto", minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
						{hasResolvedOutput ? (
							<button
								type="button"
								className="row-target"
								aria-expanded={isOpen}
								onClick={() => setIsOpen(!isOpen)}
								style={{
									background: "none",
									border: "none",
									padding: 0,
									cursor: "pointer",
									fontFamily: "var(--mono)",
									fontSize: 12,
									fontWeight: 600,
									color: "var(--t0)",
									textAlign: "left",
									minWidth: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									maxWidth: "100%",
								}}
							>
								{child.name}
							</button>
						) : (
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 12,
									fontWeight: 600,
									color: "var(--t0)",
									minWidth: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									maxWidth: "100%",
								}}
							>
								{child.name}
							</span>
						)}
						<span style={chipNeutral()}>v{child.versionId}</span>
						{isAwaited && <span style={{ ...chipStatus("var(--accent-purple)"), fontSize: 9.5 }}>awaiting</span>}
						{resolvedWait && <StatusBadge status={status as TerminalWorkflowRunStatus} size="sm" />}
						{/*
						 * The link travels with the chips rather than sitting opposite them:
						 * held out to the right it takes its width off this column, and the
						 * column is what the name and the two ids have to fit inside.
						 */}
						<Link
							to={`/runs/${child.id}`}
							onClick={(e) => e.stopPropagation()}
							style={{
								position: "relative",
								zIndex: 1,
								background: tint("var(--accent-sky)"),
								border: `1px solid ${edge("var(--accent-sky)")}`,
								color: "var(--accent-sky)",
								fontFamily: "var(--sans)",
								fontSize: 11.5,
								fontWeight: 600,
								padding: "4px 10px",
								borderRadius: "var(--r-chip)",
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
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)", whiteSpace: "nowrap" }}>
							{shortId(child.id)}
						</span>
						<CopyButton text={child.id} />
						<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--t3)", whiteSpace: "nowrap" }}>
							· {shortId(child.inputHash)}
						</span>
						<CopyButton text={child.inputHash} />
					</div>
				</div>

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

type TerminalChildWait = NonNullable<ChildWorkflowRunWaits["terminal"]>;

function ChildWorkflowResolvedPre({ wait }: { wait: TerminalChildWait }) {
	const childState = wait.state;

	if (childState.status === "completed" && childState.output !== undefined) {
		return (
			<pre
				style={{
					fontFamily: "var(--mono)",
					fontSize: 10,
					color: "var(--accent-green)",
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
					color: "var(--accent-red)",
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

function SleepRow({ name, sleeps }: { name: string; sleeps: Sleep[] }) {
	const activeSleep = sleeps.find((s) => s.status === "sleeping");
	const wakeupAt = activeSleep?.status === "sleeping" ? activeSleep.wakeupAt : undefined;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "12px 16px",
				background: "var(--s1)",
				border: "1px solid var(--b0)",
				borderRadius: "var(--r-card)",
				boxShadow: "var(--shadow-card)",
			}}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 16 16"
				fill="none"
				stroke="var(--accent-indigo)"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{ flexShrink: 0 }}
			>
				<path d="M4 2h8M4 14h8M5 2v2.5a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2M5 14v-2.5a3 3 0 0 1 3-3 3 3 0 0 1 3 3V14" />
			</svg>
			<span
				title={name}
				style={{
					fontFamily: "var(--mono)",
					fontSize: 12,
					fontWeight: 600,
					color: "var(--t0)",
					flex: "0 1 auto",
					minWidth: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{name}
			</span>
			<span style={{ flex: 1 }} />
			{wakeupAt !== undefined && <SleepCountdown wakeupAt={wakeupAt} />}
		</div>
	);
}

function SleepCountdown({ wakeupAt }: { wakeupAt: number }) {
	const [remaining, setRemaining] = useState(() => timeUntil(wakeupAt));
	useEffect(() => {
		const interval = setInterval(() => setRemaining(timeUntil(wakeupAt)), 1000);
		return () => clearInterval(interval);
	}, [wakeupAt]);
	return <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent-indigo)" }}>{remaining}</span>;
}

// ── Events ────────────────────────────────────────────────────────────────────

function EventRow({
	name,
	waits,
	isWaiting,
	timeoutAt,
}: {
	name: string;
	waits: EventWait<unknown>[];
	isWaiting: boolean;
	timeoutAt?: number;
}) {
	const hasWaits = waits.length > 0;
	const [isOpen, setIsOpen] = useState(false);

	return (
		<div>
			{/* Header card — the event name expands the received payloads */}
			<div
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "12px 16px",
					background: isWaiting ? tint("var(--accent-pink)") : "var(--s1)",
					border: `1px solid ${isWaiting ? edge("var(--accent-pink)") : "var(--b0)"}`,
					borderRadius: isOpen ? "var(--r-card) var(--r-card) 0 0" : "var(--r-card)",
					boxShadow: isOpen ? "none" : "var(--shadow-card)",
					cursor: hasWaits ? "pointer" : "default",
					transition: "background-color .16s ease, border-color .16s ease",
				}}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					stroke="var(--accent-pink)"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ flexShrink: 0 }}
				>
					<path d="M8 1.5v1M8 13a1.5 1.5 0 0 1-1.5 1.5h3A1.5 1.5 0 0 1 8 13Zm0 0V12M12 7c0-2.2-1.8-4-4-4S4 4.8 4 7c0 2.5-1.5 4-2 5h12c-.5-1-2-2.5-2-5Z" />
				</svg>
				{hasWaits ? (
					<button
						type="button"
						className="row-target"
						aria-expanded={isOpen}
						onClick={() => setIsOpen(!isOpen)}
						title={name}
						style={{
							background: "none",
							border: "none",
							padding: 0,
							cursor: "pointer",
							fontFamily: "var(--mono)",
							fontSize: 12,
							fontWeight: 600,
							color: "var(--t0)",
							textAlign: "left",
							/* Shrinks and truncates rather than pushing the chevron out of the card. */
							flex: "0 1 auto",
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{name}
					</button>
				) : (
					<span
						title={name}
						style={{
							fontFamily: "var(--mono)",
							fontSize: 12,
							fontWeight: 600,
							color: "var(--t0)",
							flex: "0 1 auto",
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{name}
					</span>
				)}
				{isWaiting && <span style={{ ...chipStatus("var(--accent-pink)"), fontSize: 9.5 }}>waiting</span>}
				<span style={{ flex: 1 }} />
				{isWaiting && timeoutAt !== undefined && <EventTimeoutCountdown timeoutAt={timeoutAt} />}
				{hasWaits && (
					<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--t3)", whiteSpace: "nowrap" }}>
						{waits.length} received
					</span>
				)}
				{hasWaits && <ChevronIcon open={isOpen} />}
			</div>

			{/* Expanded waits */}
			{isOpen && hasWaits && (
				<div
					style={{
						background: "var(--s1)",
						border: "1px solid var(--b0)",
						borderTop: "none",
						borderRadius: "0 0 var(--r-card) var(--r-card)",
						boxShadow: "var(--shadow-card)",
						padding: "10px 16px 14px",
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
	return <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent-pink)" }}>timeout {label}</span>;
}

function EventWaitRow({ wait }: { wait: EventWait<unknown> }) {
	const isReceived = wait.status === "received";
	const color = isReceived ? "var(--accent-green)" : "var(--accent-orange)";

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
				{isReceived && wait.data !== undefined && <DataBlock text={JSON.stringify(wait.data, null, 2)} />}
			</div>
		</div>
	);
}

// ── Error block ───────────────────────────────────────────────────────────────

type FailedState = Extract<WorkflowRunRecord["state"], { status: "failed" }>;

function ErrorBlock({ state }: { state: FailedState }) {
	const error = state.cause === "self" ? state.error : undefined;

	return (
		<div
			style={{
				padding: "16px 18px",
				background: tint("var(--accent-red)"),
				border: `1px solid ${edge("var(--accent-red)")}`,
				borderRadius: "var(--r-card)",
				marginTop: 10,
				minWidth: 0,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					fontSize: 12.5,
					fontWeight: 700,
					color: "var(--accent-red)",
					marginBottom: 8,
					display: "flex",
					alignItems: "center",
					gap: 6,
				}}
			>
				✕ Error
				<span style={chipNeutral()}>{state.cause}</span>
			</div>

			{state.cause === "task" && (
				<pre
					style={{
						fontFamily: "var(--mono)",
						fontSize: 11,
						color: "var(--accent-red)",
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
						color: "var(--accent-red)",
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
							color: "var(--accent-red)",
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
