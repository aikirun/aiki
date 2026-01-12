import { useState } from "react";

import { CheckIcon, CopyIcon } from "./Icons";

interface CopyButtonProps {
	text: string;
	title?: string;
}

export function CopyButton({ text, title = "Copy" }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
			title={copied ? "Copied!" : title}
		>
			{copied ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5" />}
		</button>
	);
}
