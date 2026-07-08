import type { WorkflowRunListItem } from "@aikirun/types/api/workflow-run";
import { Link } from "react-router-dom";

import { TaskSummaryBar } from "./TaskSummaryBar";
import { useElementWidth } from "../../hooks/useElementWidth";
import { CopyButton } from "../common/CopyButton";
import { RelativeTime } from "../common/RelativeTime";
import { StatusBadge } from "../common/StatusBadge";

interface RunRowProps {
	run: WorkflowRunListItem;
}

export function RunRow({ run }: RunRowProps) {
	const [rowRef, rowWidth] = useElementWidth<HTMLAnchorElement>();
	const showRef = rowWidth >= 400;
	const showVersion = rowWidth >= 340;
	const showDate = rowWidth >= 300;

	return (
		<Link
			ref={rowRef}
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
			<div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
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
					{showVersion && (
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
					)}
					<StatusBadge status={run.status} />
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
						<span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--t3)", whiteSpace: "nowrap" }}>
							ID: {run.id.slice(-6)}
						</span>
						<CopyButton text={run.id} />
					</div>

					{showRef && run.referenceId ? (
						<>
							<span style={{ color: "var(--t1)", fontSize: 10, fontWeight: 700, marginLeft: -2, marginRight: 2 }}>
								•
							</span>
							<div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
								<span
									style={{
										fontFamily: "monospace",
										fontSize: 10,
										color: "var(--t3)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										maxWidth: 120,
									}}
									title={run.referenceId}
								>
									REF: {run.referenceId}
								</span>
								<CopyButton text={run.referenceId} />
							</div>
						</>
					) : null}

					{run.taskCounts && <TaskSummaryBar taskCounts={run.taskCounts} />}
				</div>
			</div>

			{/* Hidden on very tiny rows, where it floats between the two lines and looks misaligned */}
			{showDate && (
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
			)}
		</Link>
	);
}
