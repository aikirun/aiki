import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import type { CSSProperties } from "react";

import { StatusChips } from "./StatusChips";
import { WorkflowSearchInput } from "./WorkflowSearchInput";
import { useWorkflowVersions } from "../../api/hooks";

interface RunsFilterBarProps {
	idFilter: string;
	onIdFilterChange: (v: string) => void;
	referenceIdFilter: string;
	onReferenceIdFilterChange: (v: string) => void;
	scheduleIdFilter: string;
	onScheduleIdFilterChange: (v: string) => void;
	workflowFilter: string;
	onWorkflowFilterChange: (v: string) => void;
	versionFilter: string;
	onVersionFilterChange: (v: string) => void;
	selectedStatuses: WorkflowRunStatus[];
	onSelectedStatusesChange: (v: WorkflowRunStatus[]) => void;
}

const inputStyle: CSSProperties = {
	backgroundColor: "var(--s1)",
	border: "1px solid var(--b0)",
	borderRadius: 6,
	padding: "5px 9px",
	fontFamily: "monospace",
	fontSize: 11.5,
	color: "var(--t0)",
	outline: "none",
	width: "100%",
};

interface FilterInputProps {
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
}

function FilterInput({ value, onChange, placeholder }: FilterInputProps) {
	return (
		<div style={{ flex: 1, minWidth: 120 }}>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				style={inputStyle}
			/>
		</div>
	);
}

export function RunsFilterBar({
	idFilter,
	onIdFilterChange,
	referenceIdFilter,
	onReferenceIdFilterChange,
	scheduleIdFilter,
	onScheduleIdFilterChange,
	workflowFilter,
	onWorkflowFilterChange,
	versionFilter,
	onVersionFilterChange,
	selectedStatuses,
	onSelectedStatusesChange,
}: RunsFilterBarProps) {
	const { data: versionsData } = useWorkflowVersions(workflowFilter);
	const hasVersions = workflowFilter && versionsData?.versions && versionsData.versions.length > 0;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			{/* Row 1: ID, Ref, Schedule filters */}
			<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
				<FilterInput value={idFilter} onChange={onIdFilterChange} placeholder="Run ID" />
				<FilterInput value={referenceIdFilter} onChange={onReferenceIdFilterChange} placeholder="Reference ID" />
				<FilterInput value={scheduleIdFilter} onChange={onScheduleIdFilterChange} placeholder="Schedule ID" />
			</div>

			{/* Row 2: Workflow name + optional version select */}
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<div style={{ flex: 1, maxWidth: 220 }}>
					<WorkflowSearchInput value={workflowFilter} onChange={onWorkflowFilterChange} />
				</div>
				{hasVersions && (
					<select
						value={versionFilter}
						onChange={(e) => onVersionFilterChange(e.target.value)}
						style={{
							...inputStyle,
							width: "auto",
							cursor: "pointer",
						}}
					>
						<option value="">All versions</option>
						{versionsData.versions.map((v) => (
							<option key={v.versionId} value={v.versionId}>
								{v.versionId.slice(0, 8)}
							</option>
						))}
					</select>
				)}
			</div>

			{/* Row 3: Status chips */}
			<StatusChips selected={selectedStatuses} onChange={onSelectedStatusesChange} />
		</div>
	);
}
