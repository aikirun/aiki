import { type FormEvent, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { authClient } from "../../auth/client";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { FormInput } from "../../components/auth/FormInput";

function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function CreateOrganization() {
	const navigate = useNavigate();
	const { refreshOrganizations, setActiveOrganization } = useAuth();
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleNameChange = useCallback(
		(value: string) => {
			setName(value);
			if (!slugManuallyEdited) {
				setSlug(generateSlug(value));
			}
		},
		[slugManuallyEdited]
	);

	const handleSlugChange = useCallback((value: string) => {
		setSlugManuallyEdited(true);
		setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
	}, []);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		try {
			const result = await authClient.organization.create({
				name,
				slug,
				type: "team",
			});

			if (result.error) {
				setError(result.error.message || "Failed to create organization");
				return;
			}

			if (result.data) {
				await refreshOrganizations();
				await setActiveOrganization(result.data);
				navigate("/onboarding/namespace");
			}
		} catch {
			setError("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<AuthLayout title="Create your organization" subtitle="Organizations help you manage workflows and team members">
			<form onSubmit={handleSubmit} className="space-y-5">
				{error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

				<FormInput
					label="Organization name"
					type="text"
					name="name"
					value={name}
					onChange={(e) => handleNameChange(e.target.value)}
					placeholder="Acme Inc."
					required
				/>

				<div>
					<FormInput
						label="URL slug"
						type="text"
						name="slug"
						value={slug}
						onChange={(e) => handleSlugChange(e.target.value)}
						placeholder="acme-inc"
						required
						pattern="[a-z0-9-]+"
					/>
					<p className="mt-1.5 text-xs text-slate-500">
						Only lowercase letters, numbers, and hyphens. This will be used in URLs.
					</p>
				</div>

				<button
					type="submit"
					disabled={isLoading || !name || !slug}
					className="w-full py-3 px-4 bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white font-medium rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
				>
					{isLoading ? "Creating..." : "Create organization"}
				</button>
			</form>
		</AuthLayout>
	);
}
