import { Link } from "react-router-dom";

import { BackArrowIcon } from "./Icons";

interface BackLinkProps {
	to: string;
	label?: string;
}

export function BackLink({ to, label = "Back" }: BackLinkProps) {
	return (
		<Link to={to} className="inline-flex items-center gap-1 text-t-2 hover:text-t-0 transition-colors">
			<BackArrowIcon />
			{label}
		</Link>
	);
}
