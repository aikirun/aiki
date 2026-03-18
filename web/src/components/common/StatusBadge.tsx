import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

import { WORKFLOW_STATUS_CONFIG } from "../../constants/workflow-status";

interface StatusBadgeProps {
	status: WorkflowRunStatus;
	size?: "sm" | "md";
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
	const config = WORKFLOW_STATUS_CONFIG[status];
	const big = size === "md";

	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: big ? 6 : 4,
				padding: big ? "3px 11px" : "2px 8px",
				borderRadius: 999,
				background: `${config.color}20`,
				border: `1px solid ${config.color}35`,
				fontSize: big ? 12 : 10.5,
				fontWeight: 600,
				color: config.color,
			}}
		>
			<span className={config.live ? "anim-blink" : undefined} style={{ fontSize: big ? 10 : 8 }}>
				{config.glyph}
			</span>
			{config.label}
		</span>
	);
}

export function StatusDot({ status, size = 8 }: { status: WorkflowRunStatus; size?: number }) {
	const config = WORKFLOW_STATUS_CONFIG[status];
	return (
		<span
			className={`inline-block rounded-full ${config.live ? "animate-pulse" : ""}`}
			style={{
				width: size,
				height: size,
				backgroundColor: config.color,
			}}
		/>
	);
}
