interface TableSkeletonProps {
	rows: number;
	columns?: number;
}

export function TableSkeleton({ rows, columns = 4 }: TableSkeletonProps) {
	return (
		<div className="space-y-4">
			{Array.from({ length: rows }).map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
				<div key={i} className="flex gap-4 animate-pulse">
					<div className="h-4 bg-slate-200 rounded flex-1" />
					{Array.from({ length: columns - 1 }).map((_, j) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
						<div key={j} className="h-4 bg-slate-200 rounded w-20" />
					))}
				</div>
			))}
		</div>
	);
}
