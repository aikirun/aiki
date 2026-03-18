import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createNamespace } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { authClient } from "../../auth/client";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { FormInput } from "../../components/auth/FormInput";

function generateSlug(email: string): string {
	const username = email.split("@")[0] || "user";
	return username
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function SignUp() {
	const navigate = useNavigate();
	const { refetchSession, refreshOrganizations, refreshNamespaces, setActiveNamespace } = useAuth();
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

			const slug = `personal-${generateSlug(email)}`;
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

			const namespaceResult = await createNamespace("main");

			await refetchSession();
			await refreshOrganizations();
			await refreshNamespaces(organizationId);
			await setActiveNamespace(namespaceResult.namespace);

			navigate("/");
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
					{isLoading ? "Creating account..." : "Create account"}
				</button>

				<p style={{ textAlign: "center", fontSize: 13, color: "var(--t2)" }}>
					Already have an account?{" "}
					<Link to="/auth/sign-in" style={{ color: "#667eea", fontWeight: 600, textDecoration: "none" }}>
						Sign in
					</Link>
				</p>
			</form>
		</AuthLayout>
	);
}
