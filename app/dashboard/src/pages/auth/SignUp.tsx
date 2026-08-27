import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { createNamespace } from "../../api/client";
import { authClient } from "../../auth/client";
import { getSafeRedirect } from "../../auth/redirect";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { FormInput } from "../../components/auth/FormInput";
import { btnPrimary, primaryHover } from "../../components/common/ui";

function generatePersonalSlug(email: string): string {
	const username = email.split("@")[0] || "user";
	const base = username
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
	return `${base}-${suffix}`;
}

export function SignUp() {
	const location = useLocation();
	const safeRedirect = getSafeRedirect(location.search);

	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && !isLoading) {
			e.currentTarget.form?.requestSubmit();
		}
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		try {
			const signUpResult = await authClient.signUp.email({
				name,
				email,
				password,
			});

			if (signUpResult.error) {
				setError(signUpResult.error.message || "Failed to create account");
				return;
			}

			const slug = generatePersonalSlug(email);
			const orgResult = await authClient.organization.create({
				name: "Personal",
				slug,
				type: "personal",
			});

			if (orgResult.error || !orgResult.data) {
				setError(orgResult.error?.message || "Failed to create organization");
				return;
			}

			const organizationId = orgResult.data.id;

			await authClient.organization.setActive({ organizationId });

			await createNamespace("main");

			// Full reload so AuthProvider reinitializes with the new session state.
			// If an invite redirect is present, the user lands on the acceptance page.
			window.location.href = safeRedirect ?? "/";
		} catch {
			setError("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<AuthLayout title="Create your account" subtitle="Get started with Aiki workflow automation">
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
					label="Name"
					type="text"
					name="name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Your name"
					required
					autoComplete="name"
				/>

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
					placeholder="Create a password"
					required
					autoComplete="new-password"
					minLength={8}
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
					{isLoading ? "Creating account..." : "Create account"}
				</button>

				<p style={{ textAlign: "center", fontSize: 13, color: "var(--t2)" }}>
					Already have an account?{" "}
					<Link
						to={safeRedirect ? `/sign-in?redirect=${encodeURIComponent(safeRedirect)}` : "/sign-in"}
						style={{ color: "var(--accent-ink)", fontWeight: 600, textDecoration: "none" }}
					>
						Sign in
					</Link>
				</p>
			</form>
		</AuthLayout>
	);
}
