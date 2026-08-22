import type { WorkflowRunRecord } from "@aikirun/types/workflow/run";

import { DataBlock } from "../common/DataBlock";

interface DataTabProps {
	run: WorkflowRunRecord;
}

export function DataTab({ run }: DataTabProps) {
	const isCompleted = run.state.status === "completed";
	const isFailed = run.state.status === "failed";

	const stateColor = isCompleted ? "#34D399" : isFailed ? "#F87171" : "var(--t1)";

	const inputJson = run.input.encodedValue !== undefined ? JSON.stringify(run.input, null, 2) : "void";
	const stateJson = JSON.stringify(run.state, null, 2);
	const optionsJson = run.options ? JSON.stringify(run.options, null, 2) : undefined;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			{/* Input — always shown, "void" when absent */}
			<DataBlock label="Input" text={inputJson} />

			{/* Output (completed) or State (all other statuses) */}
			<DataBlock label={isCompleted ? "Output" : "State"} text={stateJson} color={stateColor} />

			{/* Options — only if present */}
			{optionsJson && <DataBlock label="Options" text={optionsJson} />}
		</div>
	);
}
