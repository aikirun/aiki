import type { WorkflowRunStatus } from "@aikirun/types/workflow/run";

import { chipStatus } from "./ui";
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
				...chipStatus(config.color),
				gap: big ? 6 : 4,
				padding: big ? "3px 10px" : "2px 7px",
				fontSize: big ? 11 : 10,
			}}
		>
			<span className={config.live ? "anim-blink" : undefined} style={{ fontSize: big ? 9 : 8 }}>
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
