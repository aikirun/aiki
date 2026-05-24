import type { AuthedRequestContextBase } from "@aikirun/lib/context";
import type { OrganizationId, OrganizationRole } from "@aikirun/types/organization";

export interface OrganizationSessionRequestContext extends AuthedRequestContextBase {
	authMethod: "organization_session";
	organizationId: OrganizationId;
	userId: string;
	organizationRole: OrganizationRole;
}

export type OrganizationManagerSessionRequestContext = OrganizationSessionRequestContext & {
	organizationRole: "owner" | "admin";
};

export function isOrganizationManager(
	context: OrganizationSessionRequestContext
): context is OrganizationManagerSessionRequestContext {
	const { organizationRole } = context;
	return organizationRole === "owner" || organizationRole === "admin";
}
