import type { WorkflowRunListItem } from "@aikirun/types/workflow-run-api";
import { Link } from "react-router-dom";

import { TaskSummaryBar } from "./TaskSummaryBar";
import { CopyButton } from "../common/CopyButton";
import { RelativeTime } from "../common/RelativeTime";
import { StatusBadge } from "../common/StatusBadge";

interface RunRowProps {
	run: WorkflowRunListItem;
}

export function RunRow({ run }: RunRowProps) {
	return (
		<Link
			to={`/runs/${run.id}`}
			style={{
				display: "grid",
				gridTemplateColumns: "1fr auto",
				padding: "11px 16px",
				backgroundColor: "var(--s1)",
				border: "1px solid transparent",
				borderRadius: 8,
				cursor: "pointer",
				textDecoration: "none",
				transition: "background-color 0.15s, border-color 0.15s",
			}}
			onMouseEnter={(e) => {
				(e.currentTarget as HTMLElement).style.backgroundColor = "var(--s2)";
				(e.currentTarget as HTMLElement).style.borderColor = "var(--b0)";
			}}
			onMouseLeave={(e) => {
				(e.currentTarget as HTMLElement).style.backgroundColor = "var(--s1)";
				(e.currentTarget as HTMLElement).style.borderColor = "transparent";
			}}
		>
			{/* Left: 2-line layout */}
			<div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
				{/* Line 1: workflow name, version badge, status pill */}
				<div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
					<span
						style={{
							fontSize: 13,
							fontWeight: 700,
							color: "var(--t0)",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					>
						{run.name}
					</span>
					<span
						style={{
							fontFamily: "monospace",
							fontSize: 10,
							color: "var(--t3)",
							backgroundColor: "var(--s3)",
							padding: "1px 5px",
							borderRadius: 4,
							flexShrink: 0,
						}}
					>
						v{run.versionId.slice(0, 8)}
					</span>
					<StatusBadge status={run.status} />
				</div>

				{/* Line 2: short ID + copy, reference ID + copy, task counts */}
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 2 }}>
						<span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--t3)" }}>{run.id.slice(-6)}</span>
						<CopyButton text={run.id} />
					</div>

					{run.referenceId ? (
						<div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
							<span
								style={{
									fontFamily: "monospace",
									fontSize: 10,
									color: "var(--t2)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									maxWidth: 120,
								}}
								title={run.referenceId}
							>
								{run.referenceId}
							</span>
							<CopyButton text={run.referenceId} />
						</div>
					) : null}

					{run.taskCounts && <TaskSummaryBar taskCounts={run.taskCounts} />}
				</div>
			</div>

			{/* Right: relative time */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					paddingLeft: 16,
					fontSize: 10.5,
					color: "var(--t3)",
					whiteSpace: "nowrap",
				}}
			>
				<RelativeTime timestamp={run.createdAt} />
			</div>
		</Link>
	);
}
