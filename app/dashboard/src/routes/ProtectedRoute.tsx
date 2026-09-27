import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { eyebrow } from "../components/common/ui";

interface ProtectedRouteProps {
	children: ReactNode;
	requireOrganization?: boolean;
	requireNamespace?: boolean;
}

function LoadingSpinner() {
	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "var(--bg)",
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
				<svg className="animate-spin h-7 w-7" style={{ color: "var(--accent-ink)" }} fill="none" viewBox="0 0 24 24">
					<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
					<path
						className="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					/>
				</svg>
				<span style={{ ...eyebrow("var(--t3)") }}>Loading</span>
			</div>
		</div>
	);
}

export function ProtectedRoute({ children, requireOrganization = true, requireNamespace = true }: ProtectedRouteProps) {
	const { isLoading, isAuthenticated, activeOrganization, activeNamespace, organizations, namespaces } = useAuth();

	if (isLoading) {
		return <LoadingSpinner />;
	}

	if (!isAuthenticated) {
		return <Navigate to="/sign-in" replace />;
	}

	if (requireOrganization && organizations.length === 0) {
		return <Navigate to="/onboarding/organization" replace />;
	}

	if (requireOrganization && !activeOrganization) {
		return <LoadingSpinner />;
	}

	if (requireNamespace && !activeNamespace && namespaces.length > 0) {
		return <LoadingSpinner />;
	}

	return <>{children}</>;
}

export function OnboardingRoute({ children }: { children: ReactNode }) {
	const { isLoading, isAuthenticated, organizations, namespaces } = useAuth();

	if (isLoading) {
		return <LoadingSpinner />;
	}

	if (!isAuthenticated) {
		return <Navigate to="/sign-in" replace />;
	}

	if (organizations.length > 0 && namespaces.length > 0) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}
