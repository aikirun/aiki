import type { NamespaceRole } from "@aikirun/types/namespace";
import type { NamespaceMemberInfo } from "@aikirun/types/namespace-api";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { createNamespace, namespaceManagementClient } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { authClient } from "../auth/client";
import { getNamespaceDotColor } from "../constants/namespace";

// --- Types ---

interface Member {
	id: string;
	userId: string;
	role: string;
	user: {
		name: string;
		email: string;
	};
}

interface Invitation {
	id: string;
	email: string;
	role: string;
	status: string;
}

interface FullOrganization {
	id: string;
	name: string;
	slug: string;
	metadata?: string | null;
	members: Member[];
	invitations: Invitation[];
}

type PageState =
	| { mode: "idle" }
	| { mode: "creating-org" }
	| { mode: "inviting" }
	| { mode: "creating-namespace" }
	| { mode: "confirming-remove"; memberId: string };

type SettingsTab = "members" | "namespaces";

// --- Main Component ---

export function OrganizationSettings() {
	const { activeOrganization, namespaces, user, refreshNamespaces, refreshOrganizations, setActiveOrganization } =
		useAuth();
	const [searchParams, setSearchParams] = useSearchParams();
	const [orgData, setOrgData] = useState<FullOrganization | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [state, setState] = useState<PageState>({ mode: "idle" });
	const tabParam = searchParams.get("tab");
	const [activeTab, setActiveTab] = useState<SettingsTab>(tabParam === "namespaces" ? "namespaces" : "members");

	// Handle query params for create flows
	useEffect(() => {
		const create = searchParams.get("create");
		if (create === "org") {
			setState({ mode: "creating-org" });
			setSearchParams(
				(prev) => {
					prev.delete("create");
					return prev;
				},
				{ replace: true }
			);
		} else if (create === "namespace") {
			setActiveTab("namespaces");
			setState({ mode: "creating-namespace" });
			setSearchParams(
				(prev) => {
					prev.delete("create");
					prev.set("tab", "namespaces");
					return prev;
				},
				{ replace: true }
			);
		}
	}, [searchParams, setSearchParams]);

	const fetchOrgData = useCallback(async () => {
		if (!activeOrganization) return;
		try {
			const result = await authClient.organization.getFullOrganization({
				query: { organizationId: activeOrganization.id },
			});
			if (result.data) {
				setOrgData(result.data as unknown as FullOrganization);
			}
		} catch {
			// silently fail — user will see empty state
		} finally {
			setIsLoading(false);
		}
	}, [activeOrganization]);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);

		(async () => {
			if (!activeOrganization) return;
			try {
				const result = await authClient.organization.getFullOrganization({
					query: { organizationId: activeOrganization.id },
				});
				if (!cancelled && result.data) {
					setOrgData(result.data as unknown as FullOrganization);
				}
			} catch {
				// silently fail — user will see empty state
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [activeOrganization]);

	if (!activeOrganization) return null;

	const orgType = getOrgType(activeOrganization, orgData);
	const isPersonal = orgType === "personal";
	const pendingInvitations = orgData?.invitations.filter((inv) => inv.status === "pending") ?? [];
	const currentMember = orgData?.members.find((m) => m.userId === user?.id);
	const canInvite = currentMember?.role === "owner" || currentMember?.role === "admin";

	return (
		<div className="space-y-6" style={{ paddingTop: 24 }}>
			{/* Create Organization Form */}
			{state.mode === "creating-org" && (
				<CreateOrganizationInline
					onCreated={async (org) => {
						await refreshOrganizations();
						await setActiveOrganization(org as Parameters<typeof setActiveOrganization>[0]);
						setState({ mode: "idle" });
					}}
					onCancel={() => setState({ mode: "idle" })}
				/>
			)}

			{/* Organization Info */}
			<Section>
				<SectionLabel>Organization Info</SectionLabel>
				<div className="space-y-2" style={{ padding: "0 16px 14px" }}>
					<InfoRow label="Name" value={activeOrganization.name} />
					<InfoRow label="Slug" value={activeOrganization.slug} />
					<InfoRow label="Type">
						<Badge>{orgType}</Badge>
					</InfoRow>
					{isPersonal && (
						<p style={{ fontSize: 12, color: "var(--t3)", marginTop: 8 }}>
							Personal organizations cannot have additional members.
						</p>
					)}
				</div>
			</Section>

			{/* Tab bar — only for non-personal orgs */}
			{!isPersonal && (
				<div
					style={{
						display: "flex",
						gap: 4,
						background: "var(--s1)",
						borderRadius: 8,
						padding: 4,
						border: "1px solid rgba(255,255,255,0.04)",
					}}
				>
					{(["members", "namespaces"] as const).map((tab) => {
						const isActive = activeTab === tab;
						const label = tab === "members" ? `Members${orgData ? ` (${orgData.members.length})` : ""}` : "Namespaces";
						return (
							<button
								key={tab}
								type="button"
								onClick={() => {
									setActiveTab(tab);
									setSearchParams(
										(prev) => {
											prev.set("tab", tab);
											return prev;
										},
										{ replace: true }
									);
									setState({ mode: "idle" });
								}}
								style={{
									background: isActive ? "var(--s3)" : "transparent",
									border: "none",
									borderRadius: 6,
									color: isActive ? "var(--t0)" : "var(--t3)",
									fontSize: 12,
									fontWeight: 600,
									padding: "5px 13px",
									cursor: "pointer",
									fontFamily: "inherit",
									transition: "background 0.1s, color 0.1s",
								}}
							>
								{label}
							</button>
						);
					})}
				</div>
			)}

			{/* Members tab (non-personal orgs only) */}
			{!isPersonal && activeTab === "members" && (
				<>
					{state.mode === "inviting" && (
						<Section>
							<div style={{ padding: "8px 16px 14px" }}>
								<InviteMemberInline
									organizationId={activeOrganization.id}
									onInvited={() => {
										fetchOrgData();
										setState({ mode: "idle" });
									}}
									onCancel={() => setState({ mode: "idle" })}
								/>
							</div>
						</Section>
					)}

					{canInvite && pendingInvitations.length > 0 && (
						<Section>
							<SectionLabel>Pending Invitations</SectionLabel>
							<div style={{ padding: "0 16px 14px" }} className="space-y-2">
								{pendingInvitations.map((inv) => (
									<InvitationRow key={inv.id} invitation={inv} onCancelled={() => fetchOrgData()} />
								))}
							</div>
						</Section>
					)}

					<Section>
						<div
							style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 0" }}
						>
							<SectionLabel style={{ padding: 0 }}>Members{orgData ? ` (${orgData.members.length})` : ""}</SectionLabel>
							{canInvite && state.mode !== "inviting" && (
								<ActionButton onClick={() => setState({ mode: "inviting" })}>Invite member</ActionButton>
							)}
						</div>

						<div style={{ padding: "8px 16px 14px" }} className="space-y-2">
							{isLoading ? (
								<LoadingRows count={2} />
							) : orgData?.members.length === 0 ? (
								<EmptyState>No members</EmptyState>
							) : (
								orgData?.members.map((member) => {
									const isOwner = member.role === "owner";
									const isSelf = member.userId === user?.id;
									const isConfirmingRemove = state.mode === "confirming-remove" && state.memberId === member.id;

									if (isConfirmingRemove) {
										return (
											<ConfirmRemoveRow
												key={member.id}
												name={member.user.name}
												onConfirm={async () => {
													await authClient.organization.removeMember({
														memberIdOrEmail: member.id,
														organizationId: activeOrganization.id,
													});
													fetchOrgData();
													setState({ mode: "idle" });
												}}
												onCancel={() => setState({ mode: "idle" })}
											/>
										);
									}

									return (
										<MemberRow
											key={member.id}
											member={member}
											isOwner={isOwner}
											isSelf={isSelf}
											canManage={canInvite}
											organizationId={activeOrganization.id}
											onRoleChanged={() => fetchOrgData()}
											onRemove={() =>
												setState({
													mode: "confirming-remove",
													memberId: member.id,
												})
											}
										/>
									);
								})
							)}
						</div>
					</Section>
				</>
			)}

			{/* Namespaces tab (or direct content for personal orgs) */}
			{(isPersonal || activeTab === "namespaces") && (
				<Section>
					<div
						style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 0" }}
					>
						<SectionLabel style={{ padding: 0 }}>Namespaces</SectionLabel>
						{canInvite && state.mode !== "creating-namespace" && (
							<ActionButton onClick={() => setState({ mode: "creating-namespace" })}>Create namespace</ActionButton>
						)}
					</div>
					<div style={{ padding: "8px 16px 14px" }} className="space-y-2">
						{state.mode === "creating-namespace" && (
							<CreateNamespaceInline
								onCreated={async () => {
									await refreshNamespaces();
									setState({ mode: "idle" });
								}}
								onCancel={() => setState({ mode: "idle" })}
							/>
						)}

						{namespaces.length === 0 ? (
							<EmptyState>No namespaces</EmptyState>
						) : (
							namespaces.map((ns) => (
								<NamespaceRow
									key={ns.id}
									namespace={ns}
									namespaceRole={ns.role}
									isLast={namespaces.length <= 1}
									canManage={canInvite}
									isPersonal={isPersonal}
									orgMembers={orgData?.members ?? []}
									onRemoved={async () => {
										await refreshNamespaces();
									}}
								/>
							))
						)}
					</div>
				</Section>
			)}
		</div>
	);
}

// --- Inline Forms ---

function CreateOrganizationInline({
	onCreated,
	onCancel,
}: {
	onCreated: (org: { id: string; name: string; slug: string; createdAt: Date }) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugTouched, setSlugTouched] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	const handleNameChange = (value: string) => {
		setName(value);
		if (!slugTouched) {
			setSlug(
				value
					.toLowerCase()
					.replace(/[^a-z0-9\s-]/g, "")
					.replace(/\s+/g, "-")
					.replace(/-+/g, "-")
			);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim() || !slug.trim()) return;

		setIsCreating(true);
		setError(null);

		try {
			const result = await authClient.organization.create({
				name: name.trim(),
				slug: slug.trim(),
				type: "team",
			});
			if (result.data) {
				onCreated(result.data as unknown as { id: string; name: string; slug: string; createdAt: Date });
			} else if (result.error) {
				setError(
					typeof result.error === "object" && result.error !== null && "message" in result.error
						? String((result.error as { message: string }).message)
						: "Failed to create organization"
				);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create organization");
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<Section>
			<SectionLabel>New Organization</SectionLabel>
			<form onSubmit={handleSubmit} style={{ padding: "0 16px 14px" }} className="space-y-3">
				<div>
					<label
						htmlFor="org-name"
						style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)", display: "block", marginBottom: 4 }}
					>
						Organization name
					</label>
					<input
						id="org-name"
						ref={nameRef}
						type="text"
						value={name}
						onChange={(e) => handleNameChange(e.target.value)}
						placeholder="Acme Inc"
						style={inputStyle}
					/>
				</div>
				<div>
					<label
						htmlFor="org-slug"
						style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)", display: "block", marginBottom: 4 }}
					>
						URL slug
					</label>
					<input
						id="org-slug"
						type="text"
						value={slug}
						onChange={(e) => {
							setSlugTouched(true);
							setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
						}}
						placeholder="acme-inc"
						style={inputStyle}
					/>
					<p style={{ fontSize: 11, color: "var(--t3)", marginTop: 4 }}>
						Only lowercase letters, numbers, and hyphens.
					</p>
				</div>
				{error && <p style={{ fontSize: 11, color: "#F87171" }}>{error}</p>}
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<button
						type="submit"
						disabled={!name.trim() || !slug.trim() || isCreating}
						style={{
							...primaryButtonStyle,
							opacity: !name.trim() || !slug.trim() || isCreating ? 0.5 : 1,
							cursor: !name.trim() || !slug.trim() || isCreating ? "not-allowed" : "pointer",
						}}
					>
						{isCreating ? "Creating..." : "Create organization"}
					</button>
					<CancelButton onClick={onCancel} />
				</div>
			</form>
		</Section>
	);
}

function InviteMemberInline({
	organizationId,
	onInvited,
	onCancel,
}: {
	organizationId: string;
	onInvited: () => void;
	onCancel: () => void;
}) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState("member");
	const [isInviting, setIsInviting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const emailRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		emailRef.current?.focus();
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email.trim()) return;

		setIsInviting(true);
		setError(null);

		try {
			const result = await authClient.organization.inviteMember({
				email: email.trim(),
				role: role as "member" | "admin",
				organizationId,
			});
			if (result.error) {
				setError(
					typeof result.error === "object" && result.error !== null && "message" in result.error
						? String((result.error as { message: string }).message)
						: "Failed to invite member"
				);
			} else {
				onInvited();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to invite member");
		} finally {
			setIsInviting(false);
		}
	};

	return (
		<div style={inlineFormContainerStyle}>
			<SectionLabel style={{ padding: 0, marginBottom: 8 }}>New Invitation</SectionLabel>
			<form onSubmit={handleSubmit}>
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<input
						ref={emailRef}
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="email@example.com"
						style={{ ...inputStyle, flex: 1 }}
					/>
					<select
						value={role}
						onChange={(e) => setRole(e.target.value)}
						style={{
							...inputStyle,
							width: 100,
							cursor: "pointer",
						}}
					>
						<option value="member">member</option>
						<option value="admin">admin</option>
					</select>
					<button
						type="submit"
						disabled={!email.trim() || isInviting}
						style={{
							...primaryButtonStyle,
							opacity: !email.trim() || isInviting ? 0.5 : 1,
							cursor: !email.trim() || isInviting ? "not-allowed" : "pointer",
						}}
					>
						{isInviting ? "Inviting..." : "Invite"}
					</button>
					<CancelButton onClick={onCancel} />
				</div>
				{error && <p style={{ fontSize: 11, color: "#F87171", marginTop: 8 }}>{error}</p>}
			</form>
		</div>
	);
}

function CreateNamespaceInline({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
	const [name, setName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;

		setIsCreating(true);
		setError(null);

		try {
			await createNamespace(name.trim());
			onCreated();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create namespace");
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<div style={inlineFormContainerStyle}>
			<SectionLabel style={{ padding: 0, marginBottom: 8 }}>New Namespace</SectionLabel>
			<form onSubmit={handleSubmit}>
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<input
						ref={nameRef}
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Namespace name"
						style={{ ...inputStyle, flex: 1 }}
					/>
					<button
						type="submit"
						disabled={!name.trim() || isCreating}
						style={{
							...primaryButtonStyle,
							opacity: !name.trim() || isCreating ? 0.5 : 1,
							cursor: !name.trim() || isCreating ? "not-allowed" : "pointer",
						}}
					>
						{isCreating ? "Creating..." : "Create"}
					</button>
					<CancelButton onClick={onCancel} />
				</div>
				{error && <p style={{ fontSize: 11, color: "#F87171", marginTop: 8 }}>{error}</p>}
			</form>
		</div>
	);
}

// --- Row Components ---

function MemberRow({
	member,
	isOwner,
	isSelf,
	canManage,
	organizationId,
	onRoleChanged,
	onRemove,
}: {
	member: Member;
	isOwner: boolean;
	isSelf: boolean;
	canManage: boolean;
	organizationId: string;
	onRoleChanged: () => void;
	onRemove: () => void;
}) {
	const [isUpdating, setIsUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleRoleChange = async (newRole: string) => {
		setIsUpdating(true);
		setError(null);
		try {
			await authClient.organization.updateMemberRole({
				memberId: member.id,
				role: newRole as "member" | "admin",
				organizationId,
			});
			onRoleChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update role");
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<div style={rowStyle}>
			<div style={{ flex: 1, minWidth: 0 }}>
				<span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t0)" }}>{member.user.name}</span>
				<span style={{ fontSize: 11, color: "var(--t3)", marginLeft: 6 }}>({member.user.email})</span>
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
				{isOwner || !canManage ? (
					<Badge>{member.role}</Badge>
				) : (
					<select
						value={member.role}
						onChange={(e) => handleRoleChange(e.target.value)}
						disabled={isUpdating}
						style={{
							background: "var(--s2)",
							border: "1px solid rgba(255,255,255,0.08)",
							borderRadius: 5,
							padding: "3px 8px",
							fontSize: 11,
							color: "var(--t1)",
							cursor: isUpdating ? "not-allowed" : "pointer",
							fontFamily: "inherit",
						}}
					>
						<option value="admin">admin</option>
						<option value="member">member</option>
					</select>
				)}
				{canManage && !isOwner && !isSelf && <DangerButton onClick={onRemove}>Remove</DangerButton>}
			</div>
			{error && <span style={{ fontSize: 11, color: "#F87171", flexShrink: 0 }}>{error}</span>}
		</div>
	);
}

function ConfirmRemoveRow({
	name,
	onConfirm,
	onCancel,
}: {
	name: string;
	onConfirm: () => Promise<void>;
	onCancel: () => void;
}) {
	const [isRemoving, setIsRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	return (
		<div style={rowStyle}>
			<div style={{ flex: 1 }}>
				<span style={{ fontSize: 12.5, color: "var(--t1)" }}>Remove {name}?</span>
				{error && <p style={{ fontSize: 11, color: "#F87171", marginTop: 4 }}>{error}</p>}
			</div>
			<div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
				<DangerButton
					onClick={async () => {
						setIsRemoving(true);
						setError(null);
						try {
							await onConfirm();
						} catch (err) {
							setError(err instanceof Error ? err.message : "Failed to remove member");
						} finally {
							setIsRemoving(false);
						}
					}}
					disabled={isRemoving}
				>
					{isRemoving ? "Removing..." : "Confirm"}
				</DangerButton>
				<CancelButton onClick={onCancel} />
			</div>
		</div>
	);
}

function InvitationRow({ invitation, onCancelled }: { invitation: Invitation; onCancelled: () => void }) {
	const [isCancelling, setIsCancelling] = useState(false);
	const [isCopied, setIsCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCancel = async () => {
		setIsCancelling(true);
		setError(null);
		try {
			await authClient.organization.cancelInvitation({
				invitationId: invitation.id,
			});
			onCancelled();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to cancel invitation");
		} finally {
			setIsCancelling(false);
		}
	};

	const handleCopyLink = async () => {
		const inviteUrl = `${window.location.origin}/invite/${invitation.id}`;
		await navigator.clipboard.writeText(inviteUrl);
		setIsCopied(true);
		setTimeout(() => setIsCopied(false), 2000);
	};

	return (
		<div style={rowStyle}>
			<div style={{ flex: 1, minWidth: 0 }}>
				<span style={{ fontSize: 12.5, color: "var(--t1)" }}>{invitation.email}</span>
				{error && <p style={{ fontSize: 11, color: "#F87171", marginTop: 4 }}>{error}</p>}
			</div>
			<span style={{ fontSize: 11, color: "var(--t3)", marginRight: 8, flexShrink: 0 }}>as {invitation.role}</span>
			<button
				type="button"
				onClick={handleCopyLink}
				style={{
					background: "none",
					border: "1px solid rgba(255,255,255,0.12)",
					borderRadius: 5,
					padding: "3px 10px",
					fontSize: 11,
					fontWeight: 600,
					color: isCopied ? "#4ADE80" : "var(--t1)",
					cursor: "pointer",
					whiteSpace: "nowrap",
					flexShrink: 0,
					transition: "color 0.15s, border-color 0.15s",
					borderColor: isCopied ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.12)",
				}}
			>
				{isCopied ? "Copied!" : "Copy Link"}
			</button>
			<DangerButton onClick={handleCancel} disabled={isCancelling}>
				{isCancelling ? "Cancelling..." : "Cancel"}
			</DangerButton>
		</div>
	);
}

function NamespaceRow({
	namespace,
	namespaceRole,
	isLast,
	canManage,
	isPersonal,
	orgMembers,
	onRemoved,
}: {
	namespace: { id: string; name: string };
	namespaceRole: NamespaceRole;
	isLast: boolean;
	canManage: boolean;
	isPersonal: boolean;
	orgMembers: Member[];
	onRemoved: () => void;
}) {
	const isNsAdmin = namespaceRole === "admin";
	const canViewMembers = namespaceRole === "admin" || namespaceRole === "member";
	const [isRemoving, setIsRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showMembers, setShowMembers] = useState(false);
	const [nsMembers, setNsMembers] = useState<NamespaceMemberInfo[] | null>(null);
	const [membersLoading, setMembersLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [addUserId, setAddUserId] = useState("");
	const [addRole, setAddRole] = useState<NamespaceRole>("member");

	const loadMembers = async () => {
		if (nsMembers !== null) return;
		setMembersLoading(true);
		try {
			const result = await namespaceManagementClient.listMembersV1({ id: namespace.id });
			setNsMembers(result.members);
		} catch {
			setError("Failed to load members");
		} finally {
			setMembersLoading(false);
		}
	};

	const handleRemove = async () => {
		if (isLast) return;
		setIsRemoving(true);
		setError(null);
		try {
			await namespaceManagementClient.deleteV1({ id: namespace.id });
			onRemoved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove namespace");
		} finally {
			setIsRemoving(false);
		}
	};

	const handleRemoveMember = async (userId: string) => {
		setIsSaving(true);
		setError(null);
		try {
			await namespaceManagementClient.removeMembershipV1({ id: namespace.id, userId });
			setNsMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove member");
		} finally {
			setIsSaving(false);
		}
	};

	const [pendingAdds, setPendingAdds] = useState<Array<{ userId: string; role: NamespaceRole }>>([]);

	const handleRoleChange = async (userId: string, newRole: NamespaceRole) => {
		setIsSaving(true);
		setError(null);
		try {
			await namespaceManagementClient.setMembershipV1({
				id: namespace.id,
				members: [{ userId, role: newRole }],
			});
			setNsMembers((prev) => prev?.map((m) => (m.userId === userId ? { ...m, role: newRole } : m)) ?? null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update role");
		} finally {
			setIsSaving(false);
		}
	};

	const addPendingMember = () => {
		if (!addUserId) return;
		if (pendingAdds.some((p) => p.userId === addUserId)) return;
		setPendingAdds((prev) => [...prev, { userId: addUserId, role: addRole }]);
		setAddUserId("");
		setAddRole("member");
	};

	const removePendingMember = (userId: string) => {
		setPendingAdds((prev) => prev.filter((p) => p.userId !== userId));
	};

	const handleSaveNewMembers = async () => {
		if (pendingAdds.length === 0) return;
		setIsSaving(true);
		setError(null);
		try {
			await namespaceManagementClient.setMembershipV1({
				id: namespace.id,
				members: pendingAdds.map((p) => ({ userId: p.userId, role: p.role })),
			});
			setPendingAdds([]);
			// Reload to get full user info
			const result = await namespaceManagementClient.listMembersV1({ id: namespace.id });
			setNsMembers(result.members);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to add members");
		} finally {
			setIsSaving(false);
		}
	};

	const allAssignedUserIds = [...(nsMembers?.map((m) => m.userId) ?? []), ...pendingAdds.map((p) => p.userId)];
	const availableOrgMembers = orgMembers.filter((om) => om.role !== "owner" && !allAssignedUserIds.includes(om.userId));

	return (
		<div>
			<div style={rowStyle}>
				<div style={{ flex: 1, minWidth: 0 }}>
					<span style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<span
							style={{
								width: 7,
								height: 7,
								borderRadius: "50%",
								background: getNamespaceDotColor(namespace.name),
								flexShrink: 0,
							}}
						/>
						<span
							style={{
								fontSize: 12.5,
								fontFamily: "IBM Plex Mono, ui-monospace, monospace",
								color: "var(--t1)",
							}}
						>
							{namespace.name}
						</span>
					</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
					{canViewMembers && !isPersonal && (
						<button
							type="button"
							onClick={() => {
								setShowMembers((prev) => !prev);
								loadMembers();
							}}
							style={{
								background: showMembers ? "rgba(102,126,234,0.1)" : "rgba(102,126,234,0.08)",
								border: `1px solid ${showMembers ? "rgba(102,126,234,0.3)" : "rgba(102,126,234,0.2)"}`,
								borderRadius: 5,
								padding: "3px 10px",
								fontSize: 11,
								fontWeight: 600,
								color: "#667eea",
								cursor: "pointer",
								whiteSpace: "nowrap",
								transition: "background 0.15s, border-color 0.15s",
							}}
						>
							{showMembers ? "Hide members" : "Members"}
						</button>
					)}
					{canManage && (
						<DangerButton
							onClick={handleRemove}
							disabled={isLast || isRemoving}
							title={isLast ? "Cannot remove the last namespace" : undefined}
						>
							{isRemoving ? "Removing..." : "Remove"}
						</DangerButton>
					)}
				</div>
			</div>
			{showMembers && canViewMembers && (
				<div style={{ padding: "8px 12px 10px" }}>
					{membersLoading ? (
						<span style={{ fontSize: 11, color: "var(--t3)" }}>Loading...</span>
					) : (
						<>
							{nsMembers && nsMembers.length === 0 && (
								<p style={{ fontSize: 11, color: "var(--t3)", marginBottom: 8 }}>No members</p>
							)}
							{nsMembers?.map((m) => (
								<div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
									<span style={{ flex: 1, fontSize: 11, color: "var(--t1)" }}>
										{m.name || m.email}
										{m.name && <span style={{ color: "var(--t3)", marginLeft: 4 }}>({m.email})</span>}
									</span>
									{isNsAdmin ? (
										<>
											<select
												value={m.role}
												onChange={(e) => handleRoleChange(m.userId, e.target.value as NamespaceRole)}
												disabled={isSaving}
												style={{
													background: "var(--s2)",
													border: "1px solid rgba(255,255,255,0.08)",
													borderRadius: 5,
													padding: "2px 6px",
													fontSize: 10,
													color: "var(--t1)",
													cursor: isSaving ? "not-allowed" : "pointer",
													fontFamily: "inherit",
												}}
											>
												<option value="admin">admin</option>
												<option value="member">member</option>
												<option value="viewer">viewer</option>
											</select>
											<DangerButton onClick={() => handleRemoveMember(m.userId)} disabled={isSaving}>
												Remove
											</DangerButton>
										</>
									) : (
										<Badge>{m.role}</Badge>
									)}
								</div>
							))}
							{isNsAdmin && pendingAdds.length > 0 && (
								<div style={{ marginTop: 8, marginBottom: 4 }}>
									<p
										style={{
											fontSize: 10,
											fontWeight: 700,
											color: "var(--t3)",
											marginBottom: 4,
											letterSpacing: "0.05em",
										}}
									>
										PENDING
									</p>
									{pendingAdds.map((p) => {
										const om = orgMembers.find((m) => m.userId === p.userId);
										return (
											<div key={p.userId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
												<span style={{ flex: 1, fontSize: 11, color: "var(--t2)" }}>{om?.user.name ?? p.userId}</span>
												<Badge>{p.role}</Badge>
												<button
													type="button"
													onClick={() => removePendingMember(p.userId)}
													style={{
														background: "none",
														border: "none",
														fontSize: 11,
														color: "var(--t3)",
														cursor: "pointer",
														padding: "2px 4px",
													}}
												>
													x
												</button>
											</div>
										);
									})}
									<ActionButton onClick={handleSaveNewMembers}>
										{isSaving ? "Saving..." : `Save (${pendingAdds.length})`}
									</ActionButton>
								</div>
							)}
							{isNsAdmin && availableOrgMembers.length > 0 && (
								<div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
									<select
										value={addUserId}
										onChange={(e) => setAddUserId(e.target.value)}
										style={{
											...inputStyle,
											flex: 1,
											fontSize: 11,
											padding: "4px 8px",
										}}
									>
										<option value="">Add member...</option>
										{availableOrgMembers.map((om) => (
											<option key={om.userId} value={om.userId}>
												{om.user.name} ({om.user.email})
											</option>
										))}
									</select>
									<select
										value={addRole}
										onChange={(e) => setAddRole(e.target.value as NamespaceRole)}
										style={{
											...inputStyle,
											width: 80,
											fontSize: 11,
											padding: "4px 8px",
										}}
									>
										<option value="admin">admin</option>
										<option value="member">member</option>
										<option value="viewer">viewer</option>
									</select>
									<ActionButton onClick={addPendingMember}>Add</ActionButton>
								</div>
							)}
						</>
					)}
				</div>
			)}
			{error && <p style={{ fontSize: 11, color: "#F87171", padding: "0 12px 4px" }}>{error}</p>}
		</div>
	);
}

// --- Shared UI Components ---

function Section({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				background: "var(--s1)",
				border: "1px solid rgba(255,255,255,0.04)",
				borderRadius: 8,
			}}
		>
			{children}
		</div>
	);
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
	return (
		<div
			style={{
				padding: "12px 16px 8px",
				fontSize: 10,
				fontWeight: 700,
				letterSpacing: "0.08em",
				color: "var(--t3)",
				fontFamily: "IBM Plex Mono, ui-monospace, monospace",
				textTransform: "uppercase",
				...style,
			}}
		>
			{children}
		</div>
	);
}

function InfoRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
			<span style={{ fontSize: 12, color: "var(--t3)", width: 48, flexShrink: 0 }}>{label}:</span>
			{children ?? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)" }}>{value}</span>}
		</div>
	);
}

function Badge({ children }: { children: React.ReactNode }) {
	return (
		<span
			style={{
				display: "inline-block",
				fontSize: 10,
				fontWeight: 600,
				padding: "2px 8px",
				borderRadius: 4,
				background: "rgba(167,139,250,0.12)",
				color: "#A78BFA",
				fontFamily: "IBM Plex Mono, ui-monospace, monospace",
			}}
		>
			{children}
		</span>
	);
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
				color: "#fff",
				fontSize: 11,
				fontWeight: 700,
				padding: "6px 12px",
				borderRadius: 6,
				border: "none",
				cursor: "pointer",
				whiteSpace: "nowrap",
			}}
		>
			{children}
		</button>
	);
}

function DangerButton({
	onClick,
	disabled,
	children,
	title,
}: {
	onClick: () => void;
	disabled?: boolean;
	children: React.ReactNode;
	title?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			style={{
				background: "none",
				border: "1px solid rgba(248, 113, 113, 0.25)",
				borderRadius: 5,
				padding: "3px 10px",
				fontSize: 11,
				fontWeight: 600,
				color: "#F87171",
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.4 : 1,
				whiteSpace: "nowrap",
				flexShrink: 0,
				transition: "opacity 0.15s",
			}}
		>
			{children}
		</button>
	);
}

function CancelButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				background: "none",
				border: "none",
				fontSize: 12,
				color: "var(--t2)",
				cursor: "pointer",
				padding: "4px",
			}}
		>
			Cancel
		</button>
	);
}

const SKELETON_KEYS = ["skeleton-a", "skeleton-b", "skeleton-c", "skeleton-d"];

function LoadingRows({ count }: { count: number }) {
	return (
		<>
			{SKELETON_KEYS.slice(0, count).map((key) => (
				<div key={key} style={{ height: 42, borderRadius: 6, background: "var(--s2)" }} className="animate-pulse" />
			))}
		</>
	);
}

function EmptyState({ children }: { children: React.ReactNode }) {
	return (
		<div style={{ padding: "20px 0", textAlign: "center" }}>
			<p style={{ fontSize: 12, color: "var(--t3)" }}>{children}</p>
		</div>
	);
}

// --- Helpers ---

function getOrgType(activeOrganization: { slug: string }, orgData: FullOrganization | null): string {
	try {
		if ("type" in activeOrganization) {
			const type = (activeOrganization as unknown as { type: string }).type;
			if (typeof type === "string") return type;
		}
		if (orgData?.metadata) {
			const parsed = JSON.parse(orgData.metadata) as Record<string, unknown>;
			if (typeof parsed.type === "string") return parsed.type;
		}
	} catch {
		// ignore parse errors
	}
	return "team";
}

// --- Shared Styles ---

const inputStyle: React.CSSProperties = {
	background: "var(--s2)",
	border: "1px solid rgba(255,255,255,0.08)",
	borderRadius: 6,
	padding: "8px 12px",
	fontSize: 12,
	color: "var(--t0)",
	outline: "none",
	fontFamily: "inherit",
};

const primaryButtonStyle: React.CSSProperties = {
	background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
	color: "#fff",
	fontSize: 12,
	fontWeight: 700,
	padding: "8px 14px",
	borderRadius: 6,
	border: "none",
	whiteSpace: "nowrap",
};

const rowStyle: React.CSSProperties = {
	background: "var(--s2)",
	border: "1px solid rgba(255,255,255,0.04)",
	borderRadius: 6,
	padding: "8px 12px",
	display: "flex",
	alignItems: "center",
	gap: 8,
};

const inlineFormContainerStyle: React.CSSProperties = {
	background: "var(--s2)",
	border: "1px solid rgba(255,255,255,0.06)",
	borderRadius: 6,
	padding: "12px 14px",
};
