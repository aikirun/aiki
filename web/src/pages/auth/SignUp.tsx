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
			<form onSubmit={handleSubmit} className="space-y-5">
				{error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

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
					className="w-full py-3 px-4 bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white font-medium rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
				>
					{isLoading ? "Creating account..." : "Create account"}
				</button>

				<p className="text-center text-sm text-slate-600">
					Already have an account?{" "}
					<Link to="/auth/sign-in" className="text-aiki-purple hover:underline font-medium">
						Sign in
					</Link>
				</p>
			</form>
		</AuthLayout>
	);
}
