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
				{error && (
					<div className="p-3 rounded-lg bg-status-failed/10 border border-status-failed/30 text-status-failed text-sm">
						{error}
					</div>
				)}

				<FormInput
					label="Namespace name"
					type="text"
					name="name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="production"
					required
				/>

				<p className="text-sm text-t-2">
					Common namespace names include: production, staging, development, or team names.
				</p>

				<button
					type="submit"
					disabled={isLoading || !name}
					style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}
					className="w-full py-3 px-4 text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
				>
					{isLoading ? "Creating..." : "Create namespace"}
				</button>
			</form>
		</AuthLayout>
	);
}
