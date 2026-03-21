import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { authClient } from "../auth/client";
import { AuthLayout } from "../components/auth/AuthLayout";

interface InvitationDetails {
	id: string;
	email: string;
	role: string;
	organizationId: string;
	inviterId: string;
	status: string;
	expiresAt: string;
	organizationName: string;
	organizationSlug: string;
	inviterEmail: string;
}

type PageState =
	| { phase: "loading" }
	| { phase: "error"; message: string }
	| { phase: "ready"; invitation: InvitationDetails }
	| { phase: "acting" };

function LoadingSpinner() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 12,
				padding: "24px 0",
			}}
		>
			<svg style={{ width: 32, height: 32, color: "#667eea" }} fill="none" viewBox="0 0 24 24" className="animate-spin">
				<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
				<path
					className="opacity-75"
					fill="currentColor"
					d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
				/>
			</svg>
			<span style={{ fontSize: 13, color: "var(--t2)" }}>Loading invitation...</span>
		</div>
	);
}

export function AcceptInvitation() {
	const { invitationId } = useParams<{ invitationId: string }>();
	const navigate = useNavigate();
	const { isLoading: authLoading, isAuthenticated } = useAuth();

	const [pageState, setPageState] = useState<PageState>({ phase: "loading" });
	const [actionError, setActionError] = useState<string | null>(null);

	useEffect(() => {
		if (authLoading) return;

		if (!isAuthenticated) {
			// Preserve the invite URL so the user can accept after signing in or signing up
			navigate(`/auth/sign-in?redirect=/invite/${invitationId}`, { replace: true });
			return;
		}

		if (!invitationId) {
			setPageState({ phase: "error", message: "Invalid invitation link." });
			return;
		}

		let cancelled = false;

		(async () => {
			try {
				// getInvitation uses `id` (not `invitationId`) as the query param
				const result = await authClient.organization.getInvitation({
					query: { id: invitationId },
				});

				if (cancelled) return;

				if (result.error || !result.data) {
					const msg = result.error?.message || "Invitation not found.";
					setPageState({ phase: "error", message: msg });
					return;
				}

				const invitation = result.data as unknown as InvitationDetails;

				if (invitation.status !== "pending") {
					const statusMessages: Record<string, string> = {
						accepted: "This invitation has already been accepted.",
						rejected: "This invitation has already been declined.",
						cancelled: "This invitation has been cancelled.",
						expired: "This invitation has expired.",
					};
					const msg = statusMessages[invitation.status] ?? "This invitation is no longer valid.";
					setPageState({ phase: "error", message: msg });
					return;
				}

				const expiresAt = new Date(invitation.expiresAt);
				if (expiresAt < new Date()) {
					setPageState({ phase: "error", message: "This invitation has expired." });
					return;
				}

				setPageState({ phase: "ready", invitation });
			} catch (err) {
				if (!cancelled) {
					setPageState({
						phase: "error",
						message: err instanceof Error ? err.message : "Failed to load invitation.",
					});
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [authLoading, isAuthenticated, invitationId, navigate]);

	const handleAccept = async () => {
		if (!invitationId) return;
		setActionError(null);
		setPageState({ phase: "acting" });

		try {
			const result = await authClient.organization.acceptInvitation({ invitationId });

			if (result.error) {
				setActionError(result.error.message || "Failed to accept invitation.");
				// Re-fetch invitation details to restore the ready state
				const invResult = await authClient.organization.getInvitation({
					query: { id: invitationId },
				});
				if (invResult.data) {
					setPageState({ phase: "ready", invitation: invResult.data as unknown as InvitationDetails });
				} else {
					setPageState({ phase: "error", message: result.error.message || "Failed to accept invitation." });
				}
				return;
			}

			// Force a full reload so AuthProvider re-initialises with the updated session/active org.
			// ProtectedRoute will handle the case where the user has no namespaces.
			window.location.href = "/";
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "An unexpected error occurred.");
			// Restore ready state so the user can retry — re-fetch invitation details
			if (invitationId) {
				const invResult = await authClient.organization.getInvitation({
					query: { id: invitationId },
				});
				if (invResult.data) {
					setPageState({ phase: "ready", invitation: invResult.data as unknown as InvitationDetails });
				}
			}
		}
	};

	const handleDecline = async () => {
		if (!invitationId) return;
		setActionError(null);
		setPageState({ phase: "acting" });

		try {
			const result = await authClient.organization.rejectInvitation({ invitationId });

			if (result.error) {
				setActionError(result.error.message || "Failed to decline invitation.");
				const invResult = await authClient.organization.getInvitation({
					query: { id: invitationId },
				});
				if (invResult.data) {
					setPageState({ phase: "ready", invitation: invResult.data as unknown as InvitationDetails });
				}
				return;
			}

			navigate("/", { replace: true });
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "An unexpected error occurred.");
			// Restore ready state so the user can retry
			if (invitationId) {
				const invResult = await authClient.organization.getInvitation({
					query: { id: invitationId },
				});
				if (invResult.data) {
					setPageState({ phase: "ready", invitation: invResult.data as unknown as InvitationDetails });
				}
			}
		}
	};

	// Show spinner while auth state is resolving or while the invitation fetch is in progress.
	// Navigation to sign-in happens inside the effect once auth is resolved.
	if (authLoading || pageState.phase === "loading") {
		return (
			<AuthLayout title="Invitation">
				<LoadingSpinner />
			</AuthLayout>
		);
	}

	if (pageState.phase === "error") {
		return (
			<AuthLayout title="Invitation" subtitle="This invitation link is not valid">
				<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					<div
						style={{
							padding: 12,
							borderRadius: 8,
							background: "rgba(248,113,113,0.08)",
							border: "1px solid rgba(248,113,113,0.2)",
							color: "#F87171",
							fontSize: 13,
							textAlign: "center",
						}}
					>
						{pageState.message}
					</div>
					<Link
						to="/"
						style={{
							display: "block",
							textAlign: "center",
							fontSize: 13,
							color: "#667eea",
							fontWeight: 600,
							textDecoration: "none",
						}}
					>
						Go to dashboard
					</Link>
				</div>
			</AuthLayout>
		);
	}

	const isActing = pageState.phase === "acting";
	const invitation = pageState.phase === "ready" ? pageState.invitation : null;

	return (
		<AuthLayout
			title="You've been invited"
			subtitle={invitation ? `to join ${invitation.organizationName}` : undefined}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
				{invitation && (
					<div
						style={{
							background: "var(--s2)",
							border: "1px solid rgba(255,255,255,0.06)",
							borderRadius: 8,
							padding: "14px 16px",
							display: "flex",
							flexDirection: "column",
							gap: 8,
						}}
					>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<span style={{ fontSize: 12, color: "var(--t2)" }}>Organization</span>
							<span style={{ fontSize: 13, fontWeight: 600, color: "var(--t0)" }}>{invitation.organizationName}</span>
						</div>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<span style={{ fontSize: 12, color: "var(--t2)" }}>Invited by</span>
							<span style={{ fontSize: 13, color: "var(--t1)" }}>{invitation.inviterEmail}</span>
						</div>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<span style={{ fontSize: 12, color: "var(--t2)" }}>Role</span>
							<span
								style={{
									display: "inline-block",
									fontSize: 10,
									fontWeight: 600,
									padding: "2px 8px",
									borderRadius: 4,
									background: "rgba(167,139,250,0.12)",
									color: "#A78BFA",
									fontFamily: "IBM Plex Mono, ui-monospace, monospace",
								}}
							>
								{invitation.role}
							</span>
						</div>
					</div>
				)}

				{actionError && (
					<div
						style={{
							padding: 10,
							borderRadius: 8,
							background: "rgba(248,113,113,0.08)",
							border: "1px solid rgba(248,113,113,0.2)",
							color: "#F87171",
							fontSize: 13,
						}}
					>
						{actionError}
					</div>
				)}

				<button
					type="button"
					onClick={handleAccept}
					disabled={isActing}
					style={{
						width: "100%",
						padding: "10px 16px",
						background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
						color: "#fff",
						fontSize: 14,
						fontWeight: 700,
						borderRadius: 8,
						border: "none",
						cursor: isActing ? "not-allowed" : "pointer",
						opacity: isActing ? 0.5 : 1,
						fontFamily: "inherit",
					}}
				>
					{isActing ? "Accepting..." : "Accept invitation"}
				</button>

				<button
					type="button"
					onClick={handleDecline}
					disabled={isActing}
					style={{
						width: "100%",
						padding: "10px 16px",
						background: "none",
						border: "1px solid rgba(248,113,113,0.25)",
						color: "#F87171",
						fontSize: 14,
						fontWeight: 600,
						borderRadius: 8,
						cursor: isActing ? "not-allowed" : "pointer",
						opacity: isActing ? 0.5 : 1,
						fontFamily: "inherit",
					}}
				>
					Decline
				</button>
			</div>
		</AuthLayout>
	);
}
