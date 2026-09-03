import { useState } from "react";

import { CheckIcon, CopyIcon } from "./Icons";

interface CopyButtonProps {
	text: string;
	title?: string;
	/** Set when the button sits on the dark code panel, where the page colours invert. */
	onDark?: boolean;
}

export function CopyButton({ text, title = "Copy", onDark = false }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const idle = onDark ? "var(--on-code-muted)" : "var(--t3)";
	const active = onDark ? "var(--code-fg)" : "var(--t1)";

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="p-1 transition-colors"
			style={{ color: idle, borderRadius: 4, position: "relative", zIndex: 1, flexShrink: 0 }}
			onMouseEnter={(e) => {
				e.currentTarget.style.color = active;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.color = idle;
			}}
			title={copied ? "Copied!" : title}
		>
			{copied ? (
				<CheckIcon className="w-3.5 h-3.5" style={{ color: onDark ? "var(--on-code-green)" : "var(--accent-green)" }} />
			) : (
				<CopyIcon className="w-3.5 h-3.5" />
			)}
		</button>
	);
}
