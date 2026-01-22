import { Route, Routes } from "react-router-dom";

import { NotFound } from "./components/common/NotFound";
import { Layout } from "./components/layout/Layout";
import { SettingsLayout } from "./components/layout/SettingsLayout";
import { ApiKeys } from "./pages/ApiKeys";
import { SignIn } from "./pages/auth/SignIn";
import { SignUp } from "./pages/auth/SignUp";
import { Dashboard } from "./pages/Dashboard";
import { CreateNamespace } from "./pages/onboarding/CreateNamespace";
import { CreateOrganization } from "./pages/onboarding/CreateOrganization";
import { RunDetail } from "./pages/RunDetail";
import { WorkflowDetail } from "./pages/WorkflowDetail";
import { OnboardingRoute, ProtectedRoute } from "./routes/ProtectedRoute";

export default function App() {
	return (
		<Routes>
			{/* Public auth routes */}
			<Route path="/auth/sign-in" element={<SignIn />} />
			<Route path="/auth/sign-up" element={<SignUp />} />

			{/* Onboarding routes - authenticated but may not have org/namespace */}
			<Route
				path="/onboarding/organization"
				element={
					<OnboardingRoute>
						<CreateOrganization />
					</OnboardingRoute>
				}
			/>
			<Route
				path="/onboarding/namespace"
				element={
					<OnboardingRoute>
						<CreateNamespace />
					</OnboardingRoute>
				}
			/>

			{/* Protected routes - require full auth with org and namespace */}
			<Route
				element={
					<ProtectedRoute>
						<Layout />
					</ProtectedRoute>
				}
			>
				<Route path="/" element={<Dashboard />} />
				<Route path="/settings" element={<SettingsLayout />}>
					<Route path="api-keys" element={<ApiKeys />} />
				</Route>
				<Route path="/workflow/:name" element={<WorkflowDetail />} />
				<Route path="/workflow/:name/run/:id" element={<RunDetail />} />
				<Route path="*" element={<NotFound />} />
			</Route>
		</Routes>
	);
}
