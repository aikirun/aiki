import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { authClient } from "./client";

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
	createdAt: Date;
	updatedAt?: Date;
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

	const refreshNamespaces = useCallback(
		async (organizationId?: string) => {
			const orgId = organizationId || activeOrganization?.id;
			if (!orgId) return;
			setNamespacesLoading(true);
			try {
				const result = await authClient.organization.listTeams({
					query: {
						organizationId: orgId,
					},
				});
				if (result.data) {
					setNamespaces(result.data as Namespace[]);
				}
			} finally {
				setNamespacesLoading(false);
				setNamespacesInitialized(true);
			}
		},
		[activeOrganization]
	);

	const setActiveOrganization = useCallback(async (org: Organization) => {
		setNamespacesLoading(true);
		try {
			await authClient.organization.setActive({ organizationId: org.id });

			const result = await authClient.organization.listTeams({
				query: { organizationId: org.id },
			});
			const newNamespaces = (result.data || []) as Namespace[];

			setActiveOrganizationState(org);
			setNamespaces(newNamespaces);

			if (newNamespaces.length > 0) {
				await authClient.organization.setActiveTeam({ teamId: newNamespaces[0].id });
				setActiveNamespaceState(newNamespaces[0]);
			} else {
				setActiveNamespaceState(null);
			}
		} finally {
			setNamespacesLoading(false);
			setNamespacesInitialized(true);
		}
	}, []);

	const setActiveNamespace = useCallback(async (namespace: Namespace) => {
		await authClient.organization.setActiveTeam({ teamId: namespace.id });
		setActiveNamespaceState(namespace);
	}, []);

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
				authClient.organization
					.listTeams({ query: { organizationId: activeOrg.id } })
					.then((result) => {
						if (result.data) {
							setNamespaces(result.data as Namespace[]);
						}
					})
					.catch((_err) => {
						// console.error("Failed to fetch namespaces:", err);
					})
					.finally(() => {
						setNamespacesLoading(false);
						setNamespacesInitialized(true);
					});
			}
		} else if (organizations.length > 0 && !activeOrganization) {
			setActiveOrganization(organizations[0]);
		}
	}, [session?.session?.activeOrganizationId, organizations, activeOrganization, setActiveOrganization]);

	useEffect(() => {
		const activeTeamId = (session?.session as { activeTeamId?: string } | undefined)?.activeTeamId;
		if (activeTeamId && namespaces.length > 0) {
			const activeNs = namespaces.find((ns) => ns.id === activeTeamId);
			if (activeNs) {
				setActiveNamespaceState(activeNs);
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
