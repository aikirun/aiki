interface StatCardProps {
	label: string;
	value: number;
	color: "blue" | "green" | "red" | "yellow" | "purple";
	icon?: "running" | "completed" | "failed" | "sleeping";
}

const colorClasses = {
	blue: {
		card: "bg-white border-slate-200",
		icon: "bg-blue-100 text-blue-600",
		value: "text-slate-900",
		accent: "bg-blue-500",
	},
	green: {
		card: "bg-white border-slate-200",
		icon: "bg-emerald-100 text-emerald-600",
		value: "text-slate-900",
		accent: "bg-emerald-500",
	},
	red: {
		card: "bg-white border-slate-200",
		icon: "bg-red-100 text-red-600",
		value: "text-slate-900",
		accent: "bg-red-500",
	},
	yellow: {
		card: "bg-white border-slate-200",
		icon: "bg-amber-100 text-amber-600",
		value: "text-slate-900",
		accent: "bg-amber-500",
	},
	purple: {
		card: "bg-white border-slate-200",
		icon: "bg-purple-100 text-aiki-purple",
		value: "text-slate-900",
		accent: "bg-aiki-purple",
	},
};

const icons = {
	running: (
		<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
			/>
			<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
		</svg>
	),
	completed: (
		<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
	),
	failed: (
		<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
	),
	sleeping: (
		<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
			/>
		</svg>
	),
};

export function StatCard({ label, value, color, icon }: StatCardProps) {
	const colors = colorClasses[color];

	return (
		<div
			className={`relative overflow-hidden rounded-2xl border-2 ${colors.card} p-5 shadow-sm hover:shadow-md transition-shadow`}
		>
			{/* Accent bar */}
			<div className={`absolute top-0 left-0 right-0 h-1 ${colors.accent}`} />

			<div className="flex items-start justify-between">
				<div>
					<div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</div>
					<div className={`text-3xl font-heading font-bold ${colors.value}`}>{value.toLocaleString()}</div>
				</div>
				{icon && <div className={`p-2.5 rounded-xl ${colors.icon}`}>{icons[icon]}</div>}
			</div>
		</div>
	);
}
