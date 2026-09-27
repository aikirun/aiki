import type { WorkflowRunListItem } from "@aikirun/types/api/workflow-run";
import { Link } from "react-router-dom";

import { TaskSummaryBar } from "./TaskSummaryBar";
import { useElementWidth } from "../../hooks/useElementWidth";
import { CopyButton } from "../common/CopyButton";
import { RelativeTime } from "../common/RelativeTime";
import { StatusBadge } from "../common/StatusBadge";
import { chipNeutral } from "../common/ui";

interface RunRowProps {
	run: WorkflowRunListItem;
}

const metaText = {
	fontFamily: "var(--mono)",
	fontSize: 10,
	color: "var(--t3)",
	whiteSpace: "nowrap" as const,
};

/**
 * The run name is the row's only real control; `row-target` stretches its hit area
 * across the row. The copy buttons sit beside it rather than inside it, which keeps
 * one interactive element per action instead of nesting buttons in a link.
 */
export function RunRow({ run }: RunRowProps) {
	const [rowRef, rowWidth] = useElementWidth<HTMLDivElement>();
	const showRef = rowWidth >= 400;
	const showVersion = rowWidth >= 340;
	const showDate = rowWidth >= 300;

	return (
		<div
			ref={rowRef}
			className="list-row"
			style={{
				position: "relative",
				display: "grid",
				gridTemplateColumns: "1fr auto",
				padding: "12px 18px",
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
					<Link
						to={`/runs/${run.id}`}
						className="row-target"
						style={{
							fontSize: 13.5,
							fontWeight: 700,
							letterSpacing: "-0.018em",
							color: "var(--t0)",
							textDecoration: "none",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					>
						{run.name}
					</Link>
					{showVersion && <span style={{ ...chipNeutral(), flexShrink: 0 }}>v{run.versionId.slice(0, 8)}</span>}
					<StatusBadge status={run.status} />
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
						<span style={metaText}>
							<span style={{ opacity: 0.62 }}>ID</span> {run.id.slice(-6)}
						</span>
						<CopyButton text={run.id} title="Copy run ID" />
					</div>

					{showRef && run.referenceId ? (
						<>
							<span style={{ color: "var(--b0)", fontSize: 10, marginLeft: -2, marginRight: 2 }}>•</span>
							<div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
								<span
									style={{
										...metaText,
										overflow: "hidden",
										textOverflow: "ellipsis",
										maxWidth: 120,
									}}
									title={run.referenceId}
								>
									<span style={{ opacity: 0.62 }}>REF</span> {run.referenceId}
								</span>
								<CopyButton text={run.referenceId} title="Copy reference ID" />
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
						fontFamily: "var(--mono)",
						fontSize: 10,
						color: "var(--t3)",
						whiteSpace: "nowrap",
					}}
				>
					<RelativeTime timestamp={run.createdAt} />
				</div>
			)}
		</div>
	);
}
