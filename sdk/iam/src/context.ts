import type { AuthedRequestContextBase, RequestContextBase } from "@aikirun/lib/context";
import type { OrganizationId } from "@aikirun/types/organization";

import type { OrganizationRole } from "./infra/db/constants/organization";

export interface OrganizationDashboardAuthorization {
	organizationId: OrganizationId;
	organizationRole: OrganizationRole;
	userId: string;
	sessionId: string;
}

export interface OrganizationSessionRequestContext extends AuthedRequestContextBase {
	organizationId: OrganizationId;
	organizationRole: OrganizationRole;
	userId: string;
	sessionId: string;
}

export type OrganizationManagerSessionRequestContext = OrganizationSessionRequestContext & {
	organizationRole: "owner" | "admin";
};

export function createOrganizationSessionRequestContext(params: {
	context: RequestContextBase;
	authorization: OrganizationDashboardAuthorization;
}): OrganizationSessionRequestContext {
	const { context, authorization } = params;
	const { organizationId, organizationRole, userId, sessionId } = authorization;
	return { ...context, requestType: "authed", organizationId, organizationRole, userId, sessionId };
}

export function isOrganizationManager(
	context: OrganizationSessionRequestContext
): context is OrganizationManagerSessionRequestContext {
	const { organizationRole } = context;
	return organizationRole === "owner" || organizationRole === "admin";
}
