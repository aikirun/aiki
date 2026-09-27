import type { TaskStateTransition, WorkflowRunStateTransition } from "@aikirun/types/workflow/state-transition";
import { Link } from "react-router-dom";

import type { ScheduledContext, TimelineLookups } from "./timeline-lookups";
import { edge, TASK_STATUS_COLORS, WORKFLOW_RUN_STATUS_COLORS } from "../../constants/status-colors";
import { WORKFLOW_STATUS_CONFIG } from "../../constants/workflow-status";
import { card, eyebrow } from "../common/ui";

interface TimelineTabProps {
	transitions: Array<WorkflowRunStateTransition | TaskStateTransition>;
	isLoading: boolean;
	lookups?: TimelineLookups;
}

function shortId(id: string): string {
	return id.length > 10 ? id.slice(-6) : id;
}

function fmtTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** Day label for the separators, e.g. "28 August". */
function fmtDay(ts: number): string {
	return new Date(ts).toLocaleDateString([], { day: "numeric", month: "long" });
}

/** Compact date for the attempt range when it spans days, e.g. "27/08". */
function fmtShortDate(ts: number): string {
	return new Date(ts).toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

/** The full instant, for the hover title on every rendered time. */
function fmtFull(ts: number): string {
	return new Date(ts).toLocaleString();
}

function isSameDay(a: number, b: number): boolean {
	const x = new Date(a);
	const y = new Date(b);
	return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

interface Attempt {
	number: number;
	transitions: Array<WorkflowRunStateTransition | TaskStateTransition>;
	indexOffset: number;
}

function groupIntoAttempts(transitions: Array<WorkflowRunStateTransition | TaskStateTransition>): Attempt[] {
	const attempts: Attempt[] = [];

	for (let i = 0; i < transitions.length; i++) {
		const t = transitions[i];
		const last = attempts[attempts.length - 1];
		// Only workflow_run transitions delimit attempt groups; task transitions
		// carry the task's own retry count and belong to whichever workflow attempt is open.
		const startsNewAttempt = !last || (t.type === "workflow_run" && t.attempt !== last.number);

		if (startsNewAttempt) {
			attempts.push({ number: t.attempt, transitions: [t], indexOffset: i });
		} else {
			last.transitions.push(t);
		}
	}

	return attempts;
}

export function TimelineTab({ transitions, isLoading, lookups }: TimelineTabProps) {
	if (isLoading) return <TimelineSkeleton />;

	if (transitions.length === 0) {
		return (
			<div style={{ textAlign: "center", padding: "32px 0", color: "var(--t2)", fontSize: 13 }}>
				No transitions recorded
			</div>
		);
	}

	const attempts = groupIntoAttempts(transitions);
	const latestAttemptNumber = attempts[attempts.length - 1]?.number ?? 0;

	return (
		<div>
			{attempts.map((attempt) => (
				<AttemptGroup
					key={attempt.number}
					attempt={attempt}
					isLatest={attempt.number === latestAttemptNumber}
					lookups={lookups}
				/>
			))}
		</div>
	);
}

function AttemptGroup({
	attempt,
	isLatest,
	lookups,
}: {
	attempt: Attempt;
	isLatest: boolean;
	lookups?: TimelineLookups;
}) {
	const times = attempt.transitions.map((t) => t.createdAt);
	const first = Math.min(...times);
	const last = Math.max(...times);
	// A bare "06:12:06 – 06:12:41" reads as 35 seconds whether it is 35 seconds or three days,
	// so the dates appear once the attempt crosses one.
	const spansDays = !isSameDay(first, last);
	const stamp = (ts: number) => (spansDays ? `${fmtShortDate(ts)} ${fmtTime(ts)}` : fmtTime(ts));
	const timeRange = times.length > 1 ? `${stamp(first)} – ${stamp(last)}` : stamp(first);

	return (
		<div style={{ marginBottom: 16 }}>
			{/* Attempt header */}
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
				<span style={{ ...eyebrow(isLatest ? "var(--accent-ink)" : "var(--t3)"), whiteSpace: "nowrap" }}>
					Attempt {attempt.number}
				</span>
				<div style={{ flex: 1, height: 1, background: "var(--b0)" }} />
				<span
					title={times.length > 1 ? `${fmtFull(first)} – ${fmtFull(last)}` : fmtFull(first)}
					style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--t3)", whiteSpace: "nowrap" }}
				>
					{timeRange}
				</span>
			</div>

			{/* Timeline items */}
			<div style={{ position: "relative", paddingLeft: 28 }}>
				{/* Vertical connector line */}
				<div
					style={{
						position: "absolute",
						left: 10,
						top: 0,
						bottom: 0,
						width: 1,
						background: "var(--b0)",
					}}
				/>
				{attempt.transitions.map((t, i) => {
					const previous = attempt.transitions[i - 1];
					return (
						<div key={t.id}>
							{previous && !isSameDay(previous.createdAt, t.createdAt) && <DaySeparator ts={t.createdAt} />}
							<TimelineItem transition={t} globalIndex={attempt.indexOffset + i} lookups={lookups} />
						</div>
					);
				})}
			</div>
		</div>
	);
}

const contextStyle: React.CSSProperties = {
	fontSize: 10,
	fontWeight: 400,
	fontStyle: "italic",
	marginLeft: 6,
};

const inlineLinkStyle: React.CSSProperties = {
	textDecoration: "none",
	borderBottom: "1px dashed currentColor",
};

function ChildWorkflowLink({ id, children }: { id: string; children: React.ReactNode }) {
	return (
		<Link to={`/runs/${id}`} style={{ ...inlineLinkStyle, color: "inherit" }}>
			{children}
		</Link>
	);
}

function ScheduledContextInfo({ ctx, color }: { ctx: ScheduledContext; color: string }) {
	const parts: React.ReactNode[] = [];

	if (ctx.actualSleepDuration) {
		parts.push(
			<span key="sleep" style={{ ...contextStyle, color }}>
				slept {ctx.actualSleepDuration}
			</span>
		);
	}

	if (ctx.eventDataName) {
		const outcome = ctx.eventTimedOut ? "timed out" : "received";
		parts.push(
			<span key="event" style={{ ...contextStyle, color }}>
				{ctx.eventDataName} ({outcome})
			</span>
		);
	}

	if (ctx.scheduledByChildWorkflowRunId) {
		const outcome = ctx.childWorkflowTimedOut ? "timed out" : (ctx.childWorkflowStatus ?? "resolved");
		parts.push(
			<span key="child" style={{ ...contextStyle, color: "var(--accent-purple)" }}>
				child{" "}
				<ChildWorkflowLink id={ctx.scheduledByChildWorkflowRunId}>
					{shortId(ctx.scheduledByChildWorkflowRunId)}
				</ChildWorkflowLink>{" "}
				{outcome}
			</span>
		);
	}

	if (parts.length === 0) return null;
	return <>{parts}</>;
}

function TimelineItem({
	transition,
	globalIndex,
	lookups,
}: {
	transition: WorkflowRunStateTransition | TaskStateTransition;
	globalIndex: number;
	lookups?: TimelineLookups;
}) {
	if (transition.type === "workflow_run") {
		const { status } = transition.state;
		const config = WORKFLOW_STATUS_CONFIG[status];
		const color = WORKFLOW_RUN_STATUS_COLORS[status] ?? "var(--t3)";
		const isRunning = status === "running";

		let reason: string | undefined;
		if (transition.state.status === "scheduled" || transition.state.status === "queued") {
			reason = transition.state.reason;
		}

		// Inline context for specific statuses
		let inlineContext: React.ReactNode = null;

		if (transition.state.status === "sleeping") {
			inlineContext = (
				<span style={{ ...contextStyle, color: "var(--accent-indigo)" }}>{transition.state.sleepName}</span>
			);
		} else if (transition.state.status === "awaiting_event") {
			inlineContext = (
				<span style={{ ...contextStyle, color: "var(--accent-pink)" }}>{transition.state.eventName}</span>
			);
		} else if (transition.state.status === "awaiting_child_workflow") {
			const childId = transition.state.childWorkflowRunId;
			inlineContext = (
				<span style={{ ...contextStyle, color: "var(--accent-purple)" }}>
					child <ChildWorkflowLink id={childId}>{shortId(childId)}</ChildWorkflowLink>
				</span>
			);
		} else if (
			(transition.state.status === "scheduled" || transition.state.status === "queued") &&
			lookups?.scheduledContext
		) {
			const ctx = lookups.scheduledContext.get(globalIndex);
			if (ctx) {
				inlineContext = <ScheduledContextInfo ctx={ctx} color={color} />;
			}
		}

		return (
			<div style={{ position: "relative", marginBottom: 6 }}>
				<Dot color={color} isRunning={isRunning} />
				<Card
					time={fmtTime(transition.createdAt)}
					fullTime={fmtFull(transition.createdAt)}
					content={
						<span>
							<span style={{ fontWeight: 500, color: "var(--t1)" }}>{config?.label ?? status}</span>
							{reason && <span style={{ color: "var(--t3)", fontWeight: 400 }}> · {reason}</span>}
							{inlineContext}
						</span>
					}
				/>
			</div>
		);
	}

	if (transition.type === "task") {
		const { status } = transition.taskState;
		const color = TASK_STATUS_COLORS[status] ?? "var(--t3)";
		const taskId = transition.taskId;

		const taskName = lookups?.taskById.get(taskId)?.name;

		const attempts =
			transition.taskState.status === "running" ||
			transition.taskState.status === "awaiting_retry" ||
			transition.taskState.status === "completed" ||
			transition.taskState.status === "failed"
				? transition.attempt
				: undefined;

		return (
			<div style={{ position: "relative", marginBottom: 6 }}>
				<Dot color={color} isRunning={status === "running"} />
				<Card
					time={fmtTime(transition.createdAt)}
					fullTime={fmtFull(transition.createdAt)}
					content={
						<span>
							<Link
								to="?tab=execution"
								style={{ ...inlineLinkStyle, fontFamily: "var(--mono)", color: "var(--t3)", fontSize: 10 }}
							>
								{taskName ?? shortId(taskId)}
							</Link>{" "}
							<span style={{ color, fontWeight: 500 }}>{status}</span>
							{attempts !== undefined && attempts > 1 && (
								<span style={{ color: "var(--t3)", marginLeft: 4 }}>×{attempts}</span>
							)}
						</span>
					}
				/>
			</div>
		);
	}

	return null;
}

function Dot({ color, isRunning }: { color: string; isRunning: boolean }) {
	return (
		<div
			className={isRunning ? "anim-blink" : undefined}
			style={{
				position: "absolute",
				left: -21,
				top: 10,
				width: 8,
				height: 8,
				borderRadius: "50%",
				background: color,
				border: "2px solid var(--bg)",
				boxShadow: `0 0 0 1px ${edge(color)}`,
			}}
		/>
	);
}

/**
 * Marks where the timeline crosses midnight. Without it the times appear to run backwards — a row
 * at 23:59 followed by one at 00:04 — with nothing to say a day passed.
 */
function DaySeparator({ ts }: { ts: number }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 12px", marginLeft: -18 }}>
			<div style={{ flex: 1, height: 1, background: "var(--b0)" }} />
			<span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--t3)", whiteSpace: "nowrap" }}>
				{fmtDay(ts)}
			</span>
			<div style={{ flex: 1, height: 1, background: "var(--b0)" }} />
		</div>
	);
}

function Card({ content, time, fullTime }: { content: React.ReactNode; time: string; fullTime?: string }) {
	return (
		<div
			style={{
				...card,
				padding: "9px 14px",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
			}}
		>
			<span style={{ fontSize: 12 }}>{content}</span>
			<span
				title={fullTime}
				style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--t3)", whiteSpace: "nowrap", flexShrink: 0 }}
			>
				{time}
			</span>
		</div>
	);
}

function TimelineSkeleton() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			{["a", "b", "c", "d"].map((key) => (
				<div key={key} style={{ ...card, height: 36, opacity: 0.5 }} />
			))}
		</div>
	);
}
