import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";

export function AppShell() {
	return (
		<div className="flex h-screen overflow-hidden bg-surface-bg">
			<Sidebar />
			<main className="flex-1 overflow-y-auto">
				<div className="max-w-[740px] mx-auto px-6 py-6">
					<Outlet />
				</div>
			</main>
		</div>
	);
}
