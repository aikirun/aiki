import type { StateTransition } from "@aikirun/types/state-transition";
import { Link } from "react-router-dom";

import type { ScheduledContext, TimelineLookups } from "./timeline-lookups";
import { TASK_STATUS_COLORS, WORKFLOW_RUN_STATUS_COLORS } from "../../constants/status-colors";
import { WORKFLOW_STATUS_CONFIG } from "../../constants/workflow-status";

interface TimelineTabProps {
	transitions: StateTransition[];
	isLoading: boolean;
	lookups?: TimelineLookups;
}

function shortId(id: string): string {
	return id.length > 10 ? id.slice(-6) : id;
}

function fmtTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

interface Attempt {
	number: number;
	transitions: StateTransition[];
	indexOffset: number;
}

function groupIntoAttempts(transitions: StateTransition[]): Attempt[] {
	const attempts: Attempt[] = [];
	let current: StateTransition[] = [];
	let currentOffset = 0;

	for (let i = 0; i < transitions.length; i++) {
		const t = transitions[i];
		// A new attempt starts only on actual retries — "new" (initial) or "retry" (workflow retry).
		// Other scheduled reasons (awake, event, child_workflow, resume, etc.) are continuations
		// within the same attempt, not new attempts.
		const isNewAttempt =
			i > 0 &&
			t.type === "workflow_run" &&
			t.state.status === "scheduled" &&
			(t.state.reason === "new" || t.state.reason === "retry");

		if (isNewAttempt) {
			if (current.length > 0) {
				attempts.push({ number: attempts.length + 1, transitions: current, indexOffset: currentOffset });
			}
			currentOffset = i;
			current = [];
		}
		current.push(t);
	}

	if (current.length > 0) {
		attempts.push({ number: attempts.length + 1, transitions: current, indexOffset: currentOffset });
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
	const latestAttemptNumber = attempts.length;

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
	const firstTime = fmtTime(Math.min(...times));
	const lastTime = fmtTime(Math.max(...times));
	const timeRange = times.length > 1 ? `${firstTime} – ${lastTime}` : firstTime;

	return (
		<div style={{ marginBottom: 16 }}>
			{/* Attempt header */}
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
				<span
					style={{
						fontSize: 11,
						fontWeight: 700,
						color: isLatest ? "var(--t0)" : "var(--t2)",
						whiteSpace: "nowrap",
					}}
				>
					Attempt {attempt.number}
				</span>
				<div style={{ flex: 1, height: 1, background: "var(--b0)" }} />
				<span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--t3)", whiteSpace: "nowrap" }}>
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
				{attempt.transitions.map((t, i) => (
					<TimelineItem key={t.id} transition={t} globalIndex={attempt.indexOffset + i} lookups={lookups} />
				))}
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
			<span key="child" style={{ ...contextStyle, color: "#C084FC" }}>
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
	transition: StateTransition;
	globalIndex: number;
	lookups?: TimelineLookups;
}) {
	if (transition.type === "workflow_run") {
		const { status } = transition.state;
		const config = WORKFLOW_STATUS_CONFIG[status];
		const color = WORKFLOW_RUN_STATUS_COLORS[status]?.tint ?? "var(--t3)";
		const isRunning = status === "running";

		let reason: string | undefined;
		if (transition.state.status === "scheduled") {
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
		} else if (transition.state.status === "scheduled" && lookups?.scheduledContext) {
			const ctx = lookups.scheduledContext.get(globalIndex);
			if (ctx) {
				inlineContext = <ScheduledContextInfo ctx={ctx} color={color} />;
			}
		}

		return (
			<div style={{ position: "relative", marginBottom: 4 }}>
				<Dot color={color} isRunning={isRunning} />
				<Card
					time={fmtTime(transition.createdAt)}
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
		const color = TASK_STATUS_COLORS[status]?.tint ?? "var(--t3)";
		const taskId = transition.taskId;

		const taskName = lookups?.taskById.get(taskId)?.name;

		const attempts =
			transition.taskState.status === "running" ||
			transition.taskState.status === "awaiting_retry" ||
			transition.taskState.status === "completed" ||
			transition.taskState.status === "failed"
				? transition.taskState.attempts
				: undefined;

		return (
			<div style={{ position: "relative", marginBottom: 4 }}>
				<Dot color={color} isRunning={status === "running"} />
				<Card
					time={fmtTime(transition.createdAt)}
					content={
						<span>
							<Link
								to="?tab=execution"
								style={{ ...inlineLinkStyle, fontFamily: "monospace", color: "var(--t3)", fontSize: 10 }}
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
				boxShadow: `0 0 0 1px ${color}30`,
			}}
		/>
	);
}

function Card({ content, time }: { content: React.ReactNode; time: string }) {
	return (
		<div
			style={{
				padding: "8px 12px",
				background: "var(--s1)",
				border: "1px solid var(--b0)",
				borderRadius: 8,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
			}}
		>
			<span style={{ fontSize: 12 }}>{content}</span>
			<span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--t3)", whiteSpace: "nowrap", flexShrink: 0 }}>
				{time}
			</span>
		</div>
	);
}

function TimelineSkeleton() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			{["a", "b", "c", "d"].map((key) => (
				<div
					key={key}
					style={{
						height: 36,
						background: "var(--s1)",
						borderRadius: 8,
						opacity: 0.5,
					}}
				/>
			))}
		</div>
	);
}
