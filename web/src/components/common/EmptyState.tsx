interface EmptyStateProps {
	title: string;
	description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
	return (
		<div className="p-12 text-center">
			<div className="text-t-2 text-lg font-medium">{title}</div>
			{description && <p className="text-t-3 text-sm mt-1">{description}</p>}
		</div>
	);
}
