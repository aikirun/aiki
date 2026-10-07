import { edge } from "../../constants/status-colors";

interface ConfirmPromptProps {
	question: string;
	/** What the button that backs out says. Set it when the action is itself a cancellation. */
	cancelLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * The question an action that cannot be undone asks before it runs. It takes the place of the
 * button that starts the action, so the item it is about stays in view.
 */
export function ConfirmPrompt({ question, cancelLabel = "Cancel", onConfirm, onCancel }: ConfirmPromptProps) {
	return (
		// The question is wider than the button it replaces. On a narrow screen the answers wrap under it.
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "flex-end",
				gap: 8,
				flexWrap: "wrap",
				minWidth: 0,
			}}
		>
			<span style={{ fontSize: 12.5, color: "var(--t1)" }}>{question}</span>
			<div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
				<button
					type="button"
					onClick={onConfirm}
					style={{
						background: "none",
						border: `1px solid ${edge("var(--accent-red)")}`,
						borderRadius: "var(--r-chip)",
						padding: "3px 10px",
						fontSize: 11,
						fontWeight: 600,
						color: "var(--accent-red)",
						cursor: "pointer",
						whiteSpace: "nowrap",
					}}
				>
					Confirm
				</button>
				<button
					type="button"
					onClick={onCancel}
					style={{
						background: "none",
						border: "none",
						padding: "4px",
						fontSize: 12,
						color: "var(--t2)",
						cursor: "pointer",
						whiteSpace: "nowrap",
					}}
				>
					{cancelLabel}
				</button>
			</div>
		</div>
	);
}
