import { UnauthorizedError } from "@aikirun/lib/error";
import type { ApiAuthorizer, CreateApiAuthorizer } from "@aikirun/types/iam";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { Database } from "@aikirun/types/infra/db";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";

import { type AuthService, createAuthService } from "./auth";
import { createRepos } from "./infra/db/repo";
import { type ApiKeyAuthorizationInfo, createApiKeyService } from "./service/api-key";

export interface ApiAuthorizerParams {
	db: Database;
	cache?: CreateCache;
	secret: string;
	baseURL: string;
	trustedOrigins: string[];
}

export interface ApiAuthorizerKeyParams {
	db: Database;
	cache?: CreateCache;
}

export interface ApiAuthorizerSessionParams {
	db: Database;
	secret: string;
	baseURL: string;
	trustedOrigins: string[];
}

const BEARER_PREFIX = "Bearer ";

function extractBearerToken(headers: Headers): string | null {
	const authHeader = headers.get("authorization");
	if (authHeader?.startsWith(BEARER_PREFIX)) {
		return authHeader.slice(BEARER_PREFIX.length);
	}
	return null;
}

function createApiKeyAuthorizer(
	params: ApiAuthorizerKeyParams,
	{ logger }: { logger: import("@aikirun/lib/logger").Logger }
): ApiAuthorizer {
	const repos = createRepos(params.db);
	const apiKeyService = createApiKeyService({
		repos,
		cache: params.cache?.<ApiKeyAuthorizationInfo>({
			logger: logger.child({ "aiki.component": "cache.apiKeyAuth" }),
			keyPrefix: "api_key:",
		}),
	});

	return async (request: Request) => {
		const apiKey = extractBearerToken(request.headers);
		if (!apiKey) {
			throw new UnauthorizedError("Invalid API key");
		}

		const result = await apiKeyService.verify(apiKey);
		if (!result) {
			throw new UnauthorizedError("Invalid API key");
		}

		return {
			organizationId: result.organizationId as OrganizationId,
			namespaceId: result.namespaceId as NamespaceId,
		};
	};
}

function key(params: ApiAuthorizerKeyParams): CreateApiAuthorizer {
	return (context) => createApiKeyAuthorizer(params, context);
}

function createSessionAuthorizer(params: ApiAuthorizerSessionParams): ApiAuthorizer {
	const authService: AuthService = createAuthService(params);

	return async (request: Request) => {
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
			organizationId: activeOrganizationId as OrganizationId,
			namespaceId: activeNamespaceId as NamespaceId,
			userId: session.session.userId,
		};
	};
}

function session(params: ApiAuthorizerSessionParams): CreateApiAuthorizer {
	return (_context) => createSessionAuthorizer(params);
}

function apiAuthorizerFn(params: ApiAuthorizerParams): CreateApiAuthorizer {
	return (context): ApiAuthorizer => {
		const apiKeyAuthorizer = createApiKeyAuthorizer({ db: params.db, cache: params.cache }, context);
		const sessionAuthorizer = createSessionAuthorizer({
			db: params.db,
			secret: params.secret,
			baseURL: params.baseURL,
			trustedOrigins: params.trustedOrigins,
		});

		return async (request) => {
			const hasBearer = request.headers.get("authorization")?.startsWith(BEARER_PREFIX);
			return hasBearer ? apiKeyAuthorizer(request) : sessionAuthorizer(request);
		};
	};
}

export const apiAuthorizer = Object.assign(apiAuthorizerFn, { key, session });
