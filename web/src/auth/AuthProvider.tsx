import type { NamespaceRole } from "@aikirun/types/namespace";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { authClient } from "./client";
import { namespaceManagementClient } from "../api/client";

interface Organization {
	id: string;
	name: string;
	slug: string;
	createdAt: Date;
}

interface Namespace {
	id: string;
	name: string;
	organizationId: string;
	role: NamespaceRole;
	createdAt: Date;
}

interface User {
	id: string;
	name: string;
	email: string;
	image?: string | null;
}

interface AuthContextValue {
	isLoading: boolean;
	isAuthenticated: boolean;
	user: User | null;
	organizations: Organization[];
	namespaces: Namespace[];
	activeOrganization: Organization | null;
	activeNamespace: Namespace | null;
	setActiveOrganization: (org: Organization) => Promise<void>;
	setActiveNamespace: (namespace: Namespace) => Promise<void>;
	refreshOrganizations: () => Promise<void>;
	refreshNamespaces: (organizationId?: string) => Promise<void>;
	signOut: () => Promise<void>;
	refetchSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const { data: session, isPending: sessionLoading, refetch } = authClient.useSession();

	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [namespaces, setNamespaces] = useState<Namespace[]>([]);
	const [activeOrganization, setActiveOrganizationState] = useState<Organization | null>(null);
	const [activeNamespace, setActiveNamespaceState] = useState<Namespace | null>(null);
	const [orgsInitialized, setOrgsInitialized] = useState(false);
	const [orgsLoading, setOrgsLoading] = useState(false);
	const [namespacesInitialized, setNamespacesInitialized] = useState(false);
	const [namespacesLoading, setNamespacesLoading] = useState(false);

	const isAuthenticated = !!session?.user;
	const user = session?.user ?? null;

	const refreshOrganizations = useCallback(async () => {
		if (!isAuthenticated) return;
		setOrgsLoading(true);
		try {
			const result = await authClient.organization.list();
			if (result.data) {
				setOrganizations(result.data as Organization[]);
			}
		} finally {
			setOrgsLoading(false);
			setOrgsInitialized(true);
		}
	}, [isAuthenticated]);

	const fetchNamespacesForOrg = useCallback(async (_orgId: string): Promise<Namespace[]> => {
		const result = await namespaceManagementClient.listV1();
		return result.namespaces.map((ns) => ({
			id: ns.id,
			name: ns.name,
			organizationId: ns.organizationId,
			role: ns.role,
			createdAt: new Date(ns.createdAt),
		}));
	}, []);

	const refreshNamespaces = useCallback(
		async (organizationId?: string) => {
			const orgId = organizationId || activeOrganization?.id;
			if (!orgId) return;
			setNamespacesLoading(true);
			try {
				const newNamespaces = await fetchNamespacesForOrg(orgId);
				setNamespaces(newNamespaces);
			} finally {
				setNamespacesLoading(false);
				setNamespacesInitialized(true);
			}
		},
		[activeOrganization, fetchNamespacesForOrg]
	);

	const setActiveOrganization = useCallback(
		async (org: Organization) => {
			setNamespacesLoading(true);
			try {
				await authClient.organization.setActive({ organizationId: org.id });

				const newNamespaces = await fetchNamespacesForOrg(org.id);

				setActiveOrganizationState(org);
				setNamespaces(newNamespaces);

				if (newNamespaces.length > 0) {
					await authClient.organization.setActiveTeam({ teamId: newNamespaces[0].id });
					setActiveNamespaceState(newNamespaces[0]);
				} else {
					setActiveNamespaceState(null);
				}

				queryClient.invalidateQueries();
			} finally {
				setNamespacesLoading(false);
				setNamespacesInitialized(true);
			}
		},
		[queryClient, fetchNamespacesForOrg]
	);

	const setActiveNamespace = useCallback(
		async (namespace: Namespace) => {
			await authClient.organization.setActiveTeam({ teamId: namespace.id });
			setActiveNamespaceState(namespace);
			queryClient.invalidateQueries();
		},
		[queryClient]
	);

	const signOut = useCallback(async () => {
		await authClient.signOut();
		setOrganizations([]);
		setNamespaces([]);
		setActiveOrganizationState(null);
		setActiveNamespaceState(null);
		setOrgsInitialized(false);
		setNamespacesInitialized(false);
	}, []);

	const refetchSession = useCallback(async () => {
		await refetch();
	}, [refetch]);

	useEffect(() => {
		if (isAuthenticated) {
			refreshOrganizations();
		}
	}, [isAuthenticated, refreshOrganizations]);

	useEffect(() => {
		if (session?.session?.activeOrganizationId && organizations.length > 0) {
			const activeOrg = organizations.find((org) => org.id === session.session.activeOrganizationId);
			if (activeOrg && activeOrg.id !== activeOrganization?.id) {
				setActiveOrganizationState(activeOrg);
				setNamespacesLoading(true);
				fetchNamespacesForOrg(activeOrg.id)
					.then((newNamespaces) => {
						setNamespaces(newNamespaces);
					})
					.catch((_err) => {
						// silently fail — user will see empty state
					})
					.finally(() => {
						setNamespacesLoading(false);
						setNamespacesInitialized(true);
					});
			} else if (!activeOrg) {
				// activeOrganizationId points to an org the user is no longer a member of.
				// Fall back to the first available org unless we've already resolved to a valid one.
				const currentStillValid = activeOrganization && organizations.some((o) => o.id === activeOrganization.id);
				if (!currentStillValid) {
					setActiveOrganization(organizations[0]);
				}
			}
		} else if (organizations.length > 0 && !activeOrganization) {
			setActiveOrganization(organizations[0]);
		}
	}, [
		session?.session?.activeOrganizationId,
		organizations,
		activeOrganization,
		setActiveOrganization,
		fetchNamespacesForOrg,
	]);

	useEffect(() => {
		const activeTeamId = (session?.session as { activeTeamId?: string } | undefined)?.activeTeamId;
		if (activeTeamId && namespaces.length > 0) {
			const activeNs = namespaces.find((ns) => ns.id === activeTeamId);
			if (activeNs) {
				setActiveNamespaceState(activeNs);
			} else {
				// activeTeamId doesn't match any namespace in the filtered list (e.g. namespace
				// was soft-deleted, or session references old namespace after org invite accept).
				// Fall back to the first available namespace.
				setActiveNamespace(namespaces[0]);
			}
		} else if (namespaces.length > 0 && !activeNamespace) {
			setActiveNamespace(namespaces[0]);
		}
	}, [session?.session, namespaces, activeNamespace, setActiveNamespace]);

	const isLoading =
		sessionLoading ||
		orgsLoading ||
		namespacesLoading ||
		(isAuthenticated && !orgsInitialized) ||
		(isAuthenticated && orgsInitialized && organizations.length > 0 && !activeOrganization) ||
		(isAuthenticated && !!activeOrganization && !namespacesInitialized);

	return (
		<AuthContext.Provider
			value={{
				isLoading,
				isAuthenticated,
				user,
				organizations,
				namespaces,
				activeOrganization,
				activeNamespace,
				setActiveOrganization,
				setActiveNamespace,
				refreshOrganizations,
				refreshNamespaces,
				signOut,
				refetchSession,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
