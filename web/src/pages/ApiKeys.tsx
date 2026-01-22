import type { ApiKeyInfo, ApiKeyStatus } from "@aikirun/types/api-key-api";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { client } from "../api/client";
import { useApiKeys } from "../api/hooks";
import { EmptyState } from "../components/common/EmptyState";
import { RelativeTime } from "../components/common/RelativeTime";
import { TableSkeleton } from "../components/common/TableSkeleton";

const STATUS_CONFIG: Record<ApiKeyStatus, { label: string; className: string }> = {
	active: {
		label: "Active",
		className: "bg-emerald-50 text-emerald-700 border-emerald-200",
	},
	revoked: {
		label: "Revoked",
		className: "bg-red-50 text-red-700 border-red-200",
	},
	expired: {
		label: "Expired",
		className: "bg-slate-100 text-slate-600 border-slate-200",
	},
};

export function ApiKeys() {
	const { data, isLoading } = useApiKeys();
	const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
	const [createdKey, setCreatedKey] = useState<string | null>(null);

	const handleKeyCreated = (apiKey: string) => {
		setCreatedKey(apiKey);
		setIsCreateModalOpen(false);
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold text-slate-900">API Keys</h2>
					<p className="text-slate-500 mt-1">Manage API keys to connect your SDK to the server</p>
				</div>
				<button
					type="button"
					onClick={() => setIsCreateModalOpen(true)}
					className="px-4 py-2 bg-aiki-purple text-white font-medium rounded-lg hover:bg-aiki-purple/90 transition-colors"
				>
					Create API Key
				</button>
			</div>

			<div className="bg-white rounded-2xl border-2 border-slate-200">
				{isLoading ? (
					<div className="p-6">
						<TableSkeleton rows={3} columns={5} />
					</div>
				) : !data || data.keyInfos.length === 0 ? (
					<EmptyState title="No API keys yet" description="Create an API key to connect your SDK to the server" />
				) : (
					<table className="w-full">
						<thead>
							<tr className="border-b border-slate-100">
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Name
								</th>
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Key Prefix
								</th>
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Status
								</th>
								<th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Created
								</th>
								<th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{data.keyInfos.map((apiKey) => (
								<ApiKeyRow key={apiKey.id} apiKey={apiKey} />
							))}
						</tbody>
					</table>
				)}
			</div>

			{isCreateModalOpen && (
				<CreateApiKeyModal onClose={() => setIsCreateModalOpen(false)} onKeyCreated={handleKeyCreated} />
			)}

			{createdKey && <KeyCreatedModal apiKey={createdKey} onClose={() => setCreatedKey(null)} />}
		</div>
	);
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKeyInfo }) {
	const queryClient = useQueryClient();
	const [isRevoking, setIsRevoking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleRevoke = async () => {
		setIsRevoking(true);
		setError(null);
		try {
			await client.apiKey.revokeV1({ id: apiKey.id });
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to revoke key");
		} finally {
			setIsRevoking(false);
		}
	};

	const config = STATUS_CONFIG[apiKey.status];

	return (
		<tr className="hover:bg-slate-50 transition-colors">
			<td className="px-6 py-4 font-medium text-slate-900">{apiKey.name}</td>
			<td className="px-6 py-4 font-mono text-sm text-slate-600">aiki_{apiKey.keyPrefix}_...</td>
			<td className="px-6 py-4">
				<span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${config.className}`}>
					{config.label}
				</span>
			</td>
			<td className="px-6 py-4 text-slate-500">
				<RelativeTime timestamp={apiKey.createdAt} />
			</td>
			<td className="px-6 py-4 text-right">
				{error && <span className="text-red-600 text-sm mr-2">{error}</span>}
				{apiKey.status === "active" && (
					<button
						type="button"
						onClick={handleRevoke}
						disabled={isRevoking}
						className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
					>
						{isRevoking ? "Revoking..." : "Revoke"}
					</button>
				)}
			</td>
		</tr>
	);
}

function CreateApiKeyModal({ onClose, onKeyCreated }: { onClose: () => void; onKeyCreated: (apiKey: string) => void }) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;

		setIsCreating(true);
		setError(null);

		try {
			const result = await client.apiKey.createV1({ name: name.trim() });
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
			onKeyCreated(result.key);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create API key");
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
				<h2 className="text-xl font-bold text-slate-900 mb-4">Create API Key</h2>
				<form onSubmit={handleSubmit}>
					<div className="mb-4">
						<label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
							Name
						</label>
						<input
							id="name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g., Production SDK"
							className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-aiki-purple/20 focus:border-aiki-purple"
						/>
					</div>
					{error && <p className="text-red-600 text-sm mb-4">{error}</p>}
					<div className="flex gap-3 justify-end">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 text-slate-700 font-medium rounded-lg hover:bg-slate-100 transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!name.trim() || isCreating}
							className="px-4 py-2 bg-aiki-purple text-white font-medium rounded-lg hover:bg-aiki-purple/90 transition-colors disabled:opacity-50"
						>
							{isCreating ? "Creating..." : "Create"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

function KeyCreatedModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(apiKey);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
				<div className="flex items-center gap-3 mb-4">
					<div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
						<svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
						</svg>
					</div>
					<h2 className="text-xl font-bold text-slate-900">API Key Created</h2>
				</div>

				<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
					<div className="flex items-start gap-2">
						<svg
							className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
						<p className="text-sm text-amber-800">Copy this key now. You won't be able to see it again.</p>
					</div>
				</div>

				<div className="bg-slate-100 rounded-lg p-4 mb-6">
					<div className="flex items-center justify-between gap-2">
						<code className="text-sm font-mono text-slate-800 break-all">{apiKey}</code>
						<button
							type="button"
							onClick={handleCopy}
							className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex-shrink-0 ${
								copied
									? "bg-emerald-100 text-emerald-700"
									: "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
							}`}
						>
							{copied ? "Copied!" : "Copy"}
						</button>
					</div>
				</div>

				<button
					type="button"
					onClick={onClose}
					className="w-full px-4 py-2 bg-aiki-purple text-white font-medium rounded-lg hover:bg-aiki-purple/90 transition-colors"
				>
					Done
				</button>
			</div>
		</div>
	);
}
