import type { TaskStatus } from "@aikirun/types/task";

import { TASK_STATUS_COLORS } from "../../constants/status-colors";

interface TaskSummaryBarProps {
	taskCounts: Record<TaskStatus, number>;
}

export function TaskSummaryBar({ taskCounts }: TaskSummaryBarProps) {
	const total = taskCounts.completed + taskCounts.running + taskCounts.failed + taskCounts.awaiting_retry;
	if (total === 0) return null;

	const segments = [
		{ count: taskCounts.completed, color: TASK_STATUS_COLORS.completed, symbol: "\u2713" },
		{ count: taskCounts.running, color: TASK_STATUS_COLORS.running, symbol: "\u25CF" },
		{ count: taskCounts.failed, color: TASK_STATUS_COLORS.failed, symbol: "\u2715" },
		{ count: taskCounts.awaiting_retry, color: TASK_STATUS_COLORS.awaiting_retry, symbol: "\u21BB" },
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
							backgroundColor: seg.color,
						}}
					/>
				))}
			</div>

			<span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--t2)", whiteSpace: "nowrap" }}>
				{segments.map((seg, i) => (
					<span key={seg.symbol}>
						{i > 0 && " "}
						<span style={{ color: seg.color }}>
							{seg.count}
							{seg.symbol}
						</span>
					</span>
				))}
			</span>
		</div>
	);
}
