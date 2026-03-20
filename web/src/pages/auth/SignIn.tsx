import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { authClient } from "../../auth/client";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { FormInput } from "../../components/auth/FormInput";

export function SignIn() {
	const navigate = useNavigate();
	const location = useLocation();
	const { refetchSession } = useAuth();

	// Extract and validate the redirect param — only allow same-origin paths to prevent open redirect
	const redirectParam = new URLSearchParams(location.search).get("redirect");
	const safeRedirect = redirectParam?.startsWith("/") ? redirectParam : null;

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
							borderRadius: 8,
							background: "rgba(248,113,113,0.08)",
							border: "1px solid rgba(248,113,113,0.2)",
							color: "#F87171",
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
						width: "100%",
						padding: "10px 16px",
						background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
						color: "#fff",
						fontSize: 14,
						fontWeight: 700,
						borderRadius: 8,
						border: "none",
						cursor: isLoading ? "not-allowed" : "pointer",
						opacity: isLoading ? 0.5 : 1,
						fontFamily: "inherit",
					}}
				>
					{isLoading ? "Signing in..." : "Sign in"}
				</button>

				<p style={{ textAlign: "center", fontSize: 13, color: "var(--t2)" }}>
					Don't have an account?{" "}
					<Link
						to={safeRedirect ? `/auth/sign-up?redirect=${encodeURIComponent(safeRedirect)}` : "/auth/sign-up"}
						style={{ color: "#667eea", fontWeight: 600, textDecoration: "none" }}
					>
						Sign up
					</Link>
				</p>
			</form>
		</AuthLayout>
	);
}
