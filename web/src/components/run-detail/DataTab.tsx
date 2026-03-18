import type { WorkflowRun } from "@aikirun/types/workflow-run";

import { CopyButton } from "../common/CopyButton";

interface DataTabProps {
	run: WorkflowRun;
}

export function DataTab({ run }: DataTabProps) {
	const isCompleted = run.state.status === "completed";
	const isFailed = run.state.status === "failed";

	const stateColor = isCompleted ? "#34D399" : isFailed ? "#F87171" : "var(--t1)";

	const inputJson = run.input !== undefined ? JSON.stringify(run.input, null, 2) : "void";
	const stateJson = JSON.stringify(run.state, null, 2);
	const optionsJson = run.options ? JSON.stringify(run.options, null, 2) : undefined;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			{/* Input — always shown, "void" when absent */}
			<DataBlock label="Input" copyText={inputJson}>
				<pre
					style={{
						fontFamily: "monospace",
						fontSize: 11,
						color: "var(--t1)",
						lineHeight: 1.6,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						margin: 0,
					}}
				>
					{inputJson}
				</pre>
			</DataBlock>

			{/* Output (completed) or State (all other statuses) */}
			<DataBlock label={isCompleted ? "Output" : "State"} copyText={stateJson}>
				<pre
					style={{
						fontFamily: "monospace",
						fontSize: 11,
						color: stateColor,
						lineHeight: 1.6,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						margin: 0,
					}}
				>
					{stateJson}
				</pre>
			</DataBlock>

			{/* Options — only if present */}
			{optionsJson && (
				<DataBlock label="Options" copyText={optionsJson}>
					<pre
						style={{
							fontFamily: "monospace",
							fontSize: 11,
							color: "var(--t1)",
							lineHeight: 1.6,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							margin: 0,
						}}
					>
						{optionsJson}
					</pre>
				</DataBlock>
			)}
		</div>
	);
}

function DataBlock({ label, copyText, children }: { label: string; copyText: string; children: React.ReactNode }) {
	return (
		<div>
			<div
				style={{
					fontSize: 9,
					fontWeight: 700,
					textTransform: "uppercase",
					letterSpacing: "0.07em",
					color: "var(--t3)",
					marginBottom: 6,
				}}
			>
				{label}
			</div>
			<div
				style={{
					position: "relative",
					background: "var(--s1)",
					border: "1px solid var(--b0)",
					borderRadius: 8,
					padding: "12px 14px",
				}}
			>
				<div style={{ position: "absolute", top: 8, right: 8 }}>
					<CopyButton text={copyText} />
				</div>
				{children}
			</div>
		</div>
	);
}
