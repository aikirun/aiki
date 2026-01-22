import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { authClient } from "../../auth/client";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { FormInput } from "../../components/auth/FormInput";

export function SignIn() {
	const navigate = useNavigate();
	const { refetchSession } = useAuth();
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

			navigate("/");
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
			<form onSubmit={handleSubmit} className="space-y-5">
				{error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

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
					className="w-full py-3 px-4 bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white font-medium rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
				>
					{isLoading ? "Signing in..." : "Sign in"}
				</button>

				<p className="text-center text-sm text-slate-600">
					Don't have an account?{" "}
					<Link to="/auth/sign-up" className="text-aiki-purple hover:underline font-medium">
						Sign up
					</Link>
				</p>
			</form>
		</AuthLayout>
	);
}
