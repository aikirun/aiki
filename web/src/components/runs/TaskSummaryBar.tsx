import type { TaskStatus } from "@aikirun/types/task";

import { TASK_STATUS_COLORS } from "../../constants/status-colors";

interface TaskSummaryBarProps {
	taskCounts: Record<TaskStatus, number>;
}

export function TaskSummaryBar({ taskCounts }: TaskSummaryBarProps) {
	const total = taskCounts.completed + taskCounts.running + taskCounts.failed + taskCounts.awaiting_retry;
	if (total === 0) return null;

	const segments = [
		{
			count: taskCounts.completed,
			tint: TASK_STATUS_COLORS.completed.tint,
			text: TASK_STATUS_COLORS.completed.text,
			symbol: "\u2713",
		},
		{
			count: taskCounts.running,
			tint: TASK_STATUS_COLORS.running.tint,
			text: TASK_STATUS_COLORS.running.text,
			symbol: "\u25CF",
		},
		{
			count: taskCounts.failed,
			tint: TASK_STATUS_COLORS.failed.tint,
			text: TASK_STATUS_COLORS.failed.text,
			symbol: "\u2715",
		},
		{
			count: taskCounts.awaiting_retry,
			tint: TASK_STATUS_COLORS.awaiting_retry.tint,
			text: TASK_STATUS_COLORS.awaiting_retry.text,
			symbol: "\u21BB",
		},
	].filter((s) => s.count > 0);

	return (
		<div className="flex items-center gap-2">
			<div
				style={{
					width: 44,
					height: 4,
					borderRadius: 2,
					display: "flex",
					gap: 0.5,
					overflow: "hidden",
					backgroundColor: "var(--s3)",
					flexShrink: 0,
				}}
			>
				{segments.map((seg) => (
					<div
						key={seg.symbol}
						style={{
							flex: seg.count,
							minWidth: 2,
							backgroundColor: seg.tint,
						}}
					/>
				))}
			</div>

			<span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--t2)", whiteSpace: "nowrap" }}>
				{segments.map((seg, i) => (
					<span key={seg.symbol}>
						{i > 0 && " "}
						<span style={{ color: seg.text }}>
							{seg.count}
							{seg.symbol}
						</span>
					</span>
				))}
			</span>
		</div>
	);
}
