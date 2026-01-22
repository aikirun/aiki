import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createNamespace } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { FormInput } from "../../components/auth/FormInput";

export function CreateNamespace() {
	const navigate = useNavigate();
	const { activeOrganization, refreshNamespaces, setActiveNamespace } = useAuth();
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!activeOrganization) {
			setError("No active organization");
			return;
		}

		setIsLoading(true);

		try {
			const result = await createNamespace(name);

			await refreshNamespaces();
			await setActiveNamespace(result.namespace);
			navigate("/");
		} catch (err) {
			setError(err instanceof Error ? err.message : "An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<AuthLayout
			title="Create a namespace"
			subtitle={`Namespaces help you organize workflows within ${activeOrganization?.name || "your organization"}`}
		>
			<form onSubmit={handleSubmit} className="space-y-5">
				{error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

				<FormInput
					label="Namespace name"
					type="text"
					name="name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="production"
					required
				/>

				<p className="text-sm text-slate-600">
					Common namespace names include: production, staging, development, or team names.
				</p>

				<button
					type="submit"
					disabled={isLoading || !name}
					className="w-full py-3 px-4 bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white font-medium rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
				>
					{isLoading ? "Creating..." : "Create namespace"}
				</button>
			</form>
		</AuthLayout>
	);
}
