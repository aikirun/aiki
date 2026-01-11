import { Route, Routes } from "react-router-dom";

import { NotFound } from "./components/common/NotFound";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./pages/Dashboard";
import { RunDetail } from "./pages/RunDetail";
import { WorkflowDetail } from "./pages/WorkflowDetail";

export default function App() {
	return (
		<Routes>
			<Route element={<Layout />}>
				<Route path="/" element={<Dashboard />} />
				<Route path="/workflow/:name" element={<WorkflowDetail />} />
				<Route path="/workflow/:name/run/:id" element={<RunDetail />} />
				<Route path="*" element={<NotFound />} />
			</Route>
		</Routes>
	);
}
