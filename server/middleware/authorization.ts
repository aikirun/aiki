import { UnauthorizedError } from "../errors";
import type { ApiKeyService } from "../service/api-key";
import type { AuthService } from "../service/auth";

export interface ApiKeyAuthorization {
	method: "api_key";
	organizationId: string;
	namespaceId: string;
}

export interface SessionAuthorization {
	method: "session";
	organizationId: string;
	namespaceId: string;
	userId: string;
}

export type Authorization = ApiKeyAuthorization | SessionAuthorization;

const BEARER_PREFIX = "Bearer ";
const BEARER_PREFIX_LENGTH = BEARER_PREFIX.length;

function extractBearerToken(headers: Headers): string | null {
	const authHeader = headers.get("authorization");
	if (authHeader?.startsWith(BEARER_PREFIX)) {
		return authHeader.slice(BEARER_PREFIX_LENGTH);
	}
	return null;
}

export function createAuthorizer(apiKeyService: ApiKeyService, authService: AuthService) {
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
			namespaceId: result.namespaceId,
			organizationId: result.organizationId,
		};
	}

	async function authorizeBySession(request: Request): Promise<SessionAuthorization> {
		const session = await authService.api.getSession({ headers: request.headers });
		if (!session?.session) {
			throw new UnauthorizedError("Not authenticated");
		}

		const activeOrganizationId = session.session.activeOrganizationId;
		if (!activeOrganizationId) {
			throw new UnauthorizedError("No active organization selected");
		}

		// TODO: investigate why better auth doesn't infer the proper type
		const activeNamespaceId = (session.session as { activeNamespaceId?: string }).activeNamespaceId;
		if (!activeNamespaceId) {
			throw new UnauthorizedError("No active namespace selected");
		}

		return {
			method: "session",
			namespaceId: activeNamespaceId,
			organizationId: activeOrganizationId,
			userId: session.session.userId,
		};
	}

	return {
		authorizeByApiKey,
		authorizeBySession,
	};
}
