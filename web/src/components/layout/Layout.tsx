import { Outlet } from "react-router-dom";

import { Header } from "./Header";

export function Layout() {
	return (
		<div className="min-h-screen">
			<Header />
			<main className="max-w-7xl mx-auto px-6 py-8">
				<Outlet />
			</main>
		</div>
	);
}
