import { NavLink, Outlet } from "react-router-dom";

const SETTINGS_NAV = [{ to: "/settings/api-keys", label: "API Keys" }];

export function SettingsLayout() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Settings</h1>
			<div className="flex gap-8">
				<aside className="w-48 flex-shrink-0">
					<nav className="space-y-1">
						{SETTINGS_NAV.map((item) => (
							<NavLink
								key={item.to}
								to={item.to}
								className={({ isActive }) =>
									`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
										isActive
											? "bg-aiki-purple/10 text-aiki-purple"
											: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
									}`
								}
							>
								{item.label}
							</NavLink>
						))}
					</nav>
				</aside>
				<main className="flex-1 min-w-0">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
