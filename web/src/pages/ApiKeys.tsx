import type { ApiKeyInfo, ApiKeyStatus } from "@aikirun/types/api-key-api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { client } from "../api/client";
import { useApiKeys } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import { RelativeTime } from "../components/common/RelativeTime";
import { API_KEY_STATUS_COLORS } from "../constants/status-colors";

type PageState = { mode: "idle" } | { mode: "creating" } | { mode: "revealed"; key: string };

const STATUS_GLYPHS: Record<ApiKeyStatus, string> = {
	active: "●",
	revoked: "●",
	expired: "●",
};

const STATUS_LABELS: Record<ApiKeyStatus, string> = {
	active: "Active",
	revoked: "Revoked",
	expired: "Expired",
};

export function ApiKeys() {
	const { data, isLoading } = useApiKeys();
	const { activeNamespace } = useAuth();
	const [state, setState] = useState<PageState>({ mode: "idle" });

	const canManageKeys = activeNamespace?.role === "admin";

	const handleKeyCreated = (apiKey: string) => {
		setState({ mode: "revealed", key: apiKey });
	};

	const showCreateForm = state.mode === "creating";
	const revealedKey = state.mode === "revealed" ? state.key : null;
	// The "Create key" button is hidden while the form is open or a key is being revealed
	const showCreateButton = canManageKeys && state.mode === "idle";

	return (
		<div className="space-y-8" style={{ paddingTop: 24 }}>
			{/* API Keys section */}
			<div className="space-y-3">
				{/* Section header row */}
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--t0)" }}>API Keys</h2>
						<p style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
							Scoped to the current namespace. Use in SDK client config.
						</p>
					</div>
					{showCreateButton && (
						<button
							type="button"
							onClick={() => setState({ mode: "creating" })}
							style={{
								background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
								color: "#fff",
								fontSize: 12,
								fontWeight: 700,
								padding: "7px 16px",
								borderRadius: 7,
								border: "none",
								cursor: "pointer",
								whiteSpace: "nowrap",
								flexShrink: 0,
							}}
						>
							Create key
						</button>
					)}
				</div>

				{/* Inline create form */}
				{showCreateForm && <CreateKeyInline onCreated={handleKeyCreated} onCancel={() => setState({ mode: "idle" })} />}

				{/* Inline key reveal */}
				{revealedKey && <KeyRevealInline apiKey={revealedKey} onDismiss={() => setState({ mode: "idle" })} />}

				{/* Key list */}
				{isLoading ? (
					<div className="space-y-2">
						{["a", "b", "c"].map((key) => (
							<div
								key={key}
								style={{ height: 58, borderRadius: 8, background: "var(--s1)" }}
								className="animate-pulse"
							/>
						))}
					</div>
				) : !data || data.keyInfos.length === 0 ? (
					<div
						style={{
							background: "var(--s1)",
							border: "1px solid rgba(255,255,255,0.04)",
							borderRadius: 8,
							padding: "40px 16px",
							textAlign: "center",
						}}
					>
						<p style={{ fontSize: 12, color: "var(--t2)" }}>No API keys yet</p>
						<p style={{ fontSize: 11, color: "var(--t3)", marginTop: 4 }}>
							Create an API key to connect your SDK to the server
						</p>
					</div>
				) : (
					<div className="space-y-2">
						{data.keyInfos.map((apiKey) => (
							<ApiKeyRow key={apiKey.id} apiKey={apiKey} canManage={canManageKeys} />
						))}
					</div>
				)}
			</div>

			{/* Usage snippet */}
			<div
				style={{
					background: "var(--s1)",
					border: "1px solid rgba(255,255,255,0.04)",
					borderRadius: 8,
					padding: "12px 14px",
				}}
			>
				<p
					style={{
						fontSize: 10,
						fontWeight: 700,
						letterSpacing: "0.08em",
						color: "var(--t3)",
						marginBottom: 8,
						fontFamily: "IBM Plex Mono, ui-monospace, monospace",
					}}
				>
					USAGE
				</p>
				<pre
					style={{
						fontSize: 12,
						fontFamily: "IBM Plex Mono, ui-monospace, monospace",
						color: "var(--t1)",
						margin: 0,
						overflowX: "auto",
						lineHeight: 1.6,
					}}
				>{`import { client } from "@aikirun/client";

const aikiClient = client({
  url: "http://localhost:9850",
  apiKey: "YOUR_API_KEY",
});`}</pre>
			</div>
		</div>
	);
}

function CreateKeyInline({ onCreated, onCancel }: { onCreated: (key: string) => void; onCancel: () => void }) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		nameInputRef.current?.focus();
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;

		setIsCreating(true);
		setError(null);

		try {
			const result = await client.apiKey.createV1({ name: name.trim() });
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
			onCreated(result.key);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create API key");
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<div
			style={{
				background: "var(--s1)",
				border: "1px solid rgba(255,255,255,0.06)",
				borderRadius: 8,
				padding: "14px 16px",
			}}
		>
			<p
				style={{
					fontSize: 10,
					fontWeight: 700,
					letterSpacing: "0.08em",
					color: "var(--t3)",
					marginBottom: 10,
					fontFamily: "IBM Plex Mono, ui-monospace, monospace",
				}}
			>
				NEW API KEY
			</p>
			<form onSubmit={handleSubmit}>
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Key name (e.g. Production SDK)"
						ref={nameInputRef}
						style={{
							flex: 1,
							background: "var(--s2)",
							border: "1px solid rgba(255,255,255,0.08)",
							borderRadius: 6,
							padding: "8px 12px",
							fontSize: 12,
							color: "var(--t0)",
							outline: "none",
							fontFamily: "inherit",
						}}
					/>
					<button
						type="submit"
						disabled={!name.trim() || isCreating}
						style={{
							background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
							color: "#fff",
							fontSize: 12,
							fontWeight: 700,
							padding: "8px 14px",
							borderRadius: 6,
							border: "none",
							cursor: !name.trim() || isCreating ? "not-allowed" : "pointer",
							opacity: !name.trim() || isCreating ? 0.5 : 1,
							whiteSpace: "nowrap",
						}}
					>
						{isCreating ? "Creating..." : "Create"}
					</button>
					<button
						type="button"
						onClick={onCancel}
						style={{
							background: "none",
							border: "none",
							fontSize: 12,
							color: "var(--t2)",
							cursor: "pointer",
							padding: "8px 4px",
						}}
					>
						Cancel
					</button>
				</div>
				{error && <p style={{ fontSize: 11, color: "#F87171", marginTop: 8 }}>{error}</p>}
			</form>
		</div>
	);
}

function KeyRevealInline({ apiKey, onDismiss }: { apiKey: string; onDismiss: () => void }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(apiKey);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div
			style={{
				background: "rgba(226, 163, 54, 0.06)",
				border: "1px solid rgba(226, 163, 54, 0.2)",
				borderRadius: 8,
				padding: "14px 16px",
			}}
		>
			<p style={{ fontSize: 12, color: "#E2A336", marginBottom: 12, lineHeight: 1.5 }}>
				Copy this key now — it won't be shown again.
			</p>
			<div
				style={{
					background: "var(--s2)",
					border: "1px solid rgba(255,255,255,0.04)",
					borderRadius: 6,
					padding: "10px 12px",
					display: "flex",
					alignItems: "center",
					gap: 10,
					marginBottom: 12,
				}}
			>
				<code
					style={{
						flex: 1,
						fontSize: 12,
						fontFamily: "IBM Plex Mono, ui-monospace, monospace",
						color: "var(--t0)",
						wordBreak: "break-all",
						userSelect: "all",
					}}
				>
					{apiKey}
				</code>
				<button
					type="button"
					onClick={handleCopy}
					style={{
						background: copied ? "rgba(52, 211, 153, 0.12)" : "rgba(255,255,255,0.06)",
						border: "none",
						borderRadius: 5,
						padding: "5px 10px",
						fontSize: 11,
						fontWeight: 600,
						color: copied ? "#34D399" : "var(--t1)",
						cursor: "pointer",
						whiteSpace: "nowrap",
						flexShrink: 0,
						transition: "background 0.15s, color 0.15s",
					}}
				>
					{copied ? "Copied!" : "Copy"}
				</button>
			</div>
			<button
				type="button"
				onClick={onDismiss}
				style={{
					background: "none",
					border: "none",
					fontSize: 12,
					color: "var(--t2)",
					cursor: "pointer",
					padding: 0,
					textDecoration: "underline",
					textDecorationColor: "rgba(128,123,112,0.4)",
					textUnderlineOffset: 2,
				}}
			>
				Dismiss
			</button>
		</div>
	);
}

function ApiKeyRow({ apiKey, canManage }: { apiKey: ApiKeyInfo; canManage: boolean }) {
	const queryClient = useQueryClient();
	const [isRevoking, setIsRevoking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const color = API_KEY_STATUS_COLORS[apiKey.status] ?? "var(--t3)";

	const handleRevoke = async () => {
		setIsRevoking(true);
		setError(null);
		try {
			await client.apiKey.revokeV1({ id: apiKey.id });
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to revoke key");
			setIsRevoking(false);
		}
	};

	return (
		<div
			style={{
				background: "var(--s1)",
				border: "1px solid rgba(255,255,255,0.04)",
				borderRadius: 8,
				padding: "10px 14px",
				display: "flex",
				alignItems: "center",
				gap: 10,
			}}
		>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						style={{
							fontSize: 12.5,
							fontWeight: 600,
							color: "var(--t0)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{apiKey.name}
					</span>
					{/* Glyph-style status pill */}
					<span
						style={{
							fontSize: 11,
							fontWeight: 500,
							color,
							display: "flex",
							alignItems: "center",
							gap: 4,
						}}
					>
						<span style={{ fontSize: 8 }}>{STATUS_GLYPHS[apiKey.status]}</span>
						{STATUS_LABELS[apiKey.status]}
					</span>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						marginTop: 3,
					}}
				>
					<span
						style={{
							fontSize: 10,
							fontFamily: "IBM Plex Mono, ui-monospace, monospace",
							color: "var(--t3)",
						}}
					>
						{apiKey.keyPrefix}••••
					</span>
					<span style={{ fontSize: 10, color: "var(--t3)" }}>
						Created <RelativeTime timestamp={apiKey.createdAt} />
					</span>
					{apiKey.expiresAt && (
						<span style={{ fontSize: 10, color: "var(--t3)" }}>
							expires <RelativeTime timestamp={apiKey.expiresAt} />
						</span>
					)}
				</div>
			</div>

			{error && <span style={{ fontSize: 11, color: "#F87171", flexShrink: 0 }}>{error}</span>}

			{canManage && apiKey.status === "active" && (
				<button
					type="button"
					onClick={handleRevoke}
					disabled={isRevoking}
					style={{
						background: "none",
						border: "1px solid rgba(248, 113, 113, 0.25)",
						borderRadius: 6,
						padding: "4px 10px",
						fontSize: 11,
						fontWeight: 600,
						color: "#F87171",
						cursor: isRevoking ? "not-allowed" : "pointer",
						opacity: isRevoking ? 0.5 : 1,
						whiteSpace: "nowrap",
						flexShrink: 0,
						transition: "border-color 0.15s, opacity 0.15s",
					}}
				>
					{isRevoking ? "Revoking..." : "Revoke"}
				</button>
			)}
		</div>
	);
}
