import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

import { WORKFLOW_RUN_STATUS_COLORS } from "../../constants/status-colors";
import { WORKFLOW_STATUS_CONFIG } from "../../constants/workflow-status";

const ALL_STATUSES: WorkflowRunStatus[] = [
	"scheduled",
	"queued",
	"running",
	"paused",
	"sleeping",
	"awaiting_event",
	"awaiting_retry",
	"awaiting_child_workflow",
	"cancelled",
	"completed",
	"failed",
];

interface StatusChipsProps {
	selected: WorkflowRunStatus[];
	onChange: (statuses: WorkflowRunStatus[]) => void;
}

export function StatusChips({ selected, onChange }: StatusChipsProps) {
	const toggle = (status: WorkflowRunStatus) => {
		if (selected.includes(status)) {
			onChange(selected.filter((s) => s !== status));
		} else {
			onChange([...selected, status]);
		}
	};

	const hasActive = selected.length > 0;

	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
			{ALL_STATUSES.map((status) => {
				const config = WORKFLOW_STATUS_CONFIG[status];
				const color = WORKFLOW_RUN_STATUS_COLORS[status];
				const isActive = selected.includes(status);

				return (
					<button
						key={status}
						type="button"
						onClick={() => toggle(status)}
						style={{
							padding: "3px 8px",
							borderRadius: 999,
							fontSize: 10,
							fontWeight: 600,
							cursor: "pointer",
							transition: "all 0.15s",
							lineHeight: "1.4",
							...(isActive
								? {
										color,
										backgroundColor: `${color}20`,
										border: `1px solid ${color}35`,
									}
								: {
										color: "var(--t3)",
										backgroundColor: "transparent",
										border: "1px solid var(--b0)",
									}),
						}}
					>
						{config.label}
					</button>
				);
			})}

			{hasActive && (
				<button
					type="button"
					onClick={() => onChange([])}
					style={{
						padding: "3px 8px",
						borderRadius: 999,
						fontSize: 10,
						fontWeight: 600,
						cursor: "pointer",
						color: "var(--t3)",
						backgroundColor: "transparent",
						border: "1px solid var(--b0)",
						transition: "all 0.15s",
						lineHeight: "1.4",
					}}
				>
					Clear
				</button>
			)}
		</div>
	);
}
