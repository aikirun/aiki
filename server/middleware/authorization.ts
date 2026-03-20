import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import type { OrganizationRole } from "server/infra/db/constants/organization";

import { UnauthorizedError } from "../errors";
import type { OrganizationRepository } from "../infra/db/types/organization";
import type { ApiKeyService } from "../service/api-key";
import type { AuthService } from "../service/auth";

export type AuthorizationMethod = "api_key" | "organization_session" | "namespace_session";

export interface ApiKeyAuthorization {
	method: "api_key";
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
}

export interface OrganizationSessionAuthorization {
	method: "organization_session";
	organizationId: OrganizationId;
	userId: string;
	organizationRole: OrganizationRole;
}

export interface NamespaceSessionAuthorization {
	method: "namespace_session";
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
	userId: string;
}

export type Authorization = ApiKeyAuthorization | OrganizationSessionAuthorization | NamespaceSessionAuthorization;

const BEARER_PREFIX = "Bearer ";
const BEARER_PREFIX_LENGTH = BEARER_PREFIX.length;

function extractBearerToken(headers: Headers): string | null {
	const authHeader = headers.get("authorization");
	if (authHeader?.startsWith(BEARER_PREFIX)) {
		return authHeader.slice(BEARER_PREFIX_LENGTH);
	}
	return null;
}

export function createAuthorizer(
	apiKeyService: ApiKeyService,
	authService: AuthService,
	organizationRepo: OrganizationRepository
) {
	async function authorizeByApiKey(request: Request): Promise<ApiKeyAuthorization> {
		const apiKey = extractBearerToken(request.headers);
		if (!apiKey) {
			throw new UnauthorizedError("Invalid API key");
		}

		const result = await apiKeyService.verify(apiKey);
		if (!result) {
			throw new UnauthorizedError("Invalid API key");
		}

		return {
			method: "api_key",
			namespaceId: result.namespaceId as NamespaceId,
			organizationId: result.organizationId as OrganizationId,
		};
	}

	async function authorizeByOrganizationSession(request: Request): Promise<OrganizationSessionAuthorization> {
		const session = await authService.api.getSession({ headers: request.headers });
		if (!session?.session) {
			throw new UnauthorizedError("Not authenticated");
		}

		const activeOrganizationId = session.session.activeOrganizationId;
		if (!activeOrganizationId) {
			throw new UnauthorizedError("No active organization selected");
		}

		const organizationRole = await organizationRepo.getMemberRole(activeOrganizationId, session.session.userId);
		if (!organizationRole) {
			throw new UnauthorizedError("Not a member of this organization");
		}

		return {
			method: "organization_session",
			organizationId: activeOrganizationId as OrganizationId,
			userId: session.session.userId,
			organizationRole: organizationRole,
		};
	}

	async function authorizeByNamespaceSession(request: Request): Promise<NamespaceSessionAuthorization> {
		const session = await authService.api.getSession({ headers: request.headers });
		if (!session?.session) {
			throw new UnauthorizedError("Not authenticated");
		}

		const activeOrganizationId = session.session.activeOrganizationId;
		if (!activeOrganizationId) {
			throw new UnauthorizedError("No active organization selected");
		}

		const activeNamespaceId = session.session.activeTeamId;
		if (!activeNamespaceId) {
			throw new UnauthorizedError("No active namespace selected");
		}

		return {
			method: "namespace_session",
			organizationId: activeOrganizationId as OrganizationId,
			namespaceId: activeNamespaceId as NamespaceId,
			userId: session.session.userId,
		};
	}

	return {
		authorizeByApiKey: authorizeByApiKey,
		authorizeByOrganizationSession: authorizeByOrganizationSession,
		authorizeByNamespaceSession: authorizeByNamespaceSession,
	};
}
