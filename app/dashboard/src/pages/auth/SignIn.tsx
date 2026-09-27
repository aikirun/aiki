import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { authClient } from "../../auth/client";
import { getSafeRedirect } from "../../auth/redirect";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { FormInput } from "../../components/auth/FormInput";
import { btnPrimary, primaryHover } from "../../components/common/ui";

export function SignIn() {
	const navigate = useNavigate();
	const location = useLocation();
	const { refetchSession } = useAuth();

	const safeRedirect = getSafeRedirect(location.search);

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		try {
			const result = await authClient.signIn.email({
				email,
				password,
			});

			if (result.error) {
				setError(result.error.message || "Failed to sign in");
				return;
			}

			await refetchSession();

			navigate(safeRedirect ?? "/");
		} catch {
			setError("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && !isLoading) {
			e.currentTarget.form?.requestSubmit();
		}
	};

	return (
		<AuthLayout title="Sign in to Aiki" subtitle="Enter your credentials to access your account">
			<form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
				{error && (
					<div
						style={{
							padding: 10,
							borderRadius: "var(--r-control)",
							background: "color-mix(in srgb, var(--accent-red) var(--tint-mix), transparent)",
							border: "1px solid color-mix(in srgb, var(--accent-red) var(--edge-mix), transparent)",
							color: "var(--accent-red)",
							fontSize: 13,
						}}
					>
						{error}
					</div>
				)}

				<FormInput
					label="Email"
					type="email"
					name="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@example.com"
					required
					autoComplete="email"
				/>

				<FormInput
					label="Password"
					type="password"
					name="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Enter your password"
					required
					autoComplete="current-password"
				/>

				<button
					type="submit"
					disabled={isLoading}
					style={{
						...btnPrimary(),
						width: "100%",
						padding: "11px 16px",
						fontSize: 14,
						cursor: isLoading ? "not-allowed" : "pointer",
						opacity: isLoading ? 0.5 : 1,
					}}
					{...(isLoading ? {} : primaryHover)}
				>
					{isLoading ? "Signing in..." : "Sign in"}
				</button>

				<p style={{ textAlign: "center", fontSize: 13, color: "var(--t2)" }}>
					Don't have an account?{" "}
					<Link
						to={safeRedirect ? `/sign-up?redirect=${encodeURIComponent(safeRedirect)}` : "/sign-up"}
						style={{ color: "var(--accent-ink)", fontWeight: 600, textDecoration: "none" }}
					>
						Sign up
					</Link>
				</p>
			</form>
		</AuthLayout>
	);
}
