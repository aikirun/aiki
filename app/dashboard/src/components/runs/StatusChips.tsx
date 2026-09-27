import { WORKFLOW_RUN_STATUSES, type WorkflowRunStatus } from "@aikirun/types/workflow/run";

import { chipStatus } from "../../components/common/ui";
import { WORKFLOW_STATUS_CONFIG } from "../../constants/workflow-status";

interface StatusChipsProps {
	selected: WorkflowRunStatus[];
	onChange: (statuses: WorkflowRunStatus[]) => void;
}

const restingChip = {
	display: "inline-flex" as const,
	alignItems: "center" as const,
	padding: "4px 9px",
	borderRadius: "var(--r-chip)",
	fontFamily: "var(--sans)",
	fontSize: 11,
	fontWeight: 600,
	lineHeight: 1.45,
	cursor: "pointer",
	color: "var(--t2)",
	background: "var(--s2)",
	border: "1px solid transparent",
	transition: "color .16s ease, border-color .16s ease, background-color .16s ease",
	whiteSpace: "nowrap" as const,
};

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
		<div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
			{WORKFLOW_RUN_STATUSES.map((status) => {
				const config = WORKFLOW_STATUS_CONFIG[status];
				const isActive = selected.includes(status);

				return (
					<button
						key={status}
						type="button"
						onClick={() => toggle(status)}
						style={
							isActive
								? { ...chipStatus(config.color), padding: "4px 9px", cursor: "pointer", lineHeight: 1.45 }
								: restingChip
						}
						onMouseEnter={(e) => {
							if (!isActive) {
								e.currentTarget.style.color = "var(--t0)";
								e.currentTarget.style.background = "var(--s3)";
							}
						}}
						onMouseLeave={(e) => {
							if (!isActive) {
								e.currentTarget.style.color = "var(--t2)";
								e.currentTarget.style.background = "var(--s2)";
							}
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
					style={{ ...restingChip, color: "var(--accent-ink)", background: "var(--accent-tint)" }}
				>
					Clear
				</button>
			)}
		</div>
	);
}
