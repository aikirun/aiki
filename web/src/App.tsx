import { Navigate, Route, Routes } from "react-router-dom";

import { NotFound } from "./components/common/NotFound";
import { AppShell } from "./components/layout/AppShell";
import { SettingsLayout } from "./components/layout/SettingsLayout";
import { AcceptInvitation } from "./pages/AcceptInvitation";
import { ApiKeys } from "./pages/ApiKeys";
import { SignIn } from "./pages/auth/SignIn";
import { SignUp } from "./pages/auth/SignUp";
import { OrganizationSettings } from "./pages/OrganizationSettings";
import { CreateNamespace } from "./pages/onboarding/CreateNamespace";
import { CreateOrganization } from "./pages/onboarding/CreateOrganization";
import { RunDetail } from "./pages/RunDetail";
import { RunsList } from "./pages/RunsList";
import { SchedulesList } from "./pages/SchedulesList";
import { OnboardingRoute, ProtectedRoute } from "./routes/ProtectedRoute";

export default function App() {
	return (
		<Routes>
			{/* Public auth routes */}
			<Route path="/auth/sign-in" element={<SignIn />} />
			<Route path="/auth/sign-up" element={<SignUp />} />

			{/* Public: invitation acceptance — handles its own auth redirect logic */}
			<Route path="/invite/:invitationId" element={<AcceptInvitation />} />

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
						<AppShell />
					</ProtectedRoute>
				}
			>
				<Route path="/" element={<RunsList />} />
				<Route path="/runs/:id" element={<RunDetail />} />
				<Route path="/schedules" element={<SchedulesList />} />

				<Route path="/settings" element={<SettingsLayout />}>
					<Route index element={<Navigate to="api-keys" replace />} />
					<Route path="api-keys" element={<ApiKeys />} />
					<Route path="organization" element={<OrganizationSettings />} />
				</Route>

				{/* Redirects from old routes */}
				<Route path="/workflow/:name/run/:id" element={<OldRunRedirect />} />
				<Route path="/workflow/:name" element={<Navigate to="/" replace />} />

				<Route path="*" element={<NotFound />} />
			</Route>
		</Routes>
	);
}

function OldRunRedirect() {
	const id = window.location.pathname.split("/run/")[1];
	return <Navigate to={`/runs/${id}`} replace />;
}
