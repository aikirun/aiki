interface EmptyStateProps {
	title: string;
	description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
	return (
		<div className="p-12 text-center">
			<div className="text-slate-400 text-lg font-medium">{title}</div>
			{description && <p className="text-slate-500 text-sm mt-1">{description}</p>}
		</div>
	);
}
