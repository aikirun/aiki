import { UnauthorizedError } from "@aikirun/lib/error";
import type {
	CreateDashboardAuthenticator,
	CreateDashboardIam,
	CreateOrganizationDashboardHandler,
	DashboardAuthenticator,
	DashboardIam,
	IamContext,
	OrganizationDashboardHandler,
} from "@aikirun/types/iam";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { CreateDatabase } from "@aikirun/types/infra/db";
import type { OrganizationId } from "@aikirun/types/organization";
import { RPCHandler } from "@orpc/server/fetch";
import { ulid } from "ulidx";

import type { AuthService } from "./auth";
import type { OrganizationSessionRequestContext } from "./context";
import type { OrganizationRole } from "./infra/db/constants/organization";
import { createRepos } from "./infra/db/repo";
import type { OrganizationRepository } from "./infra/db/types/organization";
import { createOrganizationAuthedRouter } from "./router/index";
import { type ApiKeyAuthorizationInfo, createApiKeyService } from "./service/api-key";
import { createNamespaceService } from "./service/namespace";

export interface OrganizationDashboardAuthorization {
	organizationId: OrganizationId;
	organizationRole: OrganizationRole;
	userId: string;
}

export interface DashboardSessionIamParams {
	db: CreateDatabase;
	cache?: CreateCache;
	secret: string;
	baseURL: string;
	trustedOrigins: string[];
}

function authService(params: DashboardSessionIamParams) {
	let authServicePromise: Promise<AuthService> | undefined;
	return (): Promise<AuthService> => {
		authServicePromise ??= (async () => {
			const [{ createAuthService }, db] = await Promise.all([import("./auth"), params.db()]);
			return createAuthService({
				db,
				baseURL: params.baseURL,
				secret: params.secret,
				trustedOrigins: params.trustedOrigins,
			});
		})();
		return authServicePromise;
	};
}

type GetAuthService = ReturnType<typeof authService>;

async function authorizeOrganizationSession(
	authService: AuthService,
	organizationRepo: OrganizationRepository,
	request: Request
): Promise<OrganizationDashboardAuthorization> {
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
		organizationId: activeOrganizationId as OrganizationId,
		userId: session.session.userId,
		organizationRole,
	};
}

function createAuthenticator(getAuthService: GetAuthService): DashboardAuthenticator {
	let authenticator: DashboardAuthenticator | undefined;
	let createAuthenticatorPromise: Promise<DashboardAuthenticator> | undefined;

	return (request: Request) => {
		if (authenticator) {
			return authenticator(request);
		}
		return (async () => {
			createAuthenticatorPromise ??= (async () => {
				const authService = await getAuthService();
				return (request: Request) => authService.handler(request);
			})();
			authenticator = await createAuthenticatorPromise;
			return authenticator(request);
		})();
	};
}

function authenticator(params: DashboardSessionIamParams): CreateDashboardAuthenticator {
	return (_context) => createAuthenticator(authService(params));
}

function createOrganizationHandler(
	params: DashboardSessionIamParams,
	context: IamContext,
	getAuthService: GetAuthService
): OrganizationDashboardHandler {
	let handler: OrganizationDashboardHandler | undefined;
	let createHandlerPromise: Promise<OrganizationDashboardHandler> | undefined;

	return (request: Request) => {
		if (handler) {
			return handler(request);
		}
		return (async () => {
			createHandlerPromise ??= (async () => {
				const db = await params.db();
				const repos = await createRepos(db);
				const authService = await getAuthService();
				const apiKeyCache = params.cache?.<ApiKeyAuthorizationInfo>({
					logger: context.logger.child({ "aiki.component": "cache.apiKeyAuth" }),
					keyPrefix: "api_key:",
				});
				const apiKeyService = createApiKeyService({ repos, cache: apiKeyCache });
				const namespaceService = createNamespaceService({ repos, apiKeyCache });
				const router = createOrganizationAuthedRouter({ apiKeyService, namespaceService });
				const rpcHandler = new RPCHandler(router, {});

				return async (request: Request): Promise<Response> => {
					let authorization: OrganizationDashboardAuthorization;
					try {
						authorization = await authorizeOrganizationSession(authService, repos.organization, request);
					} catch (err) {
						if (err instanceof UnauthorizedError) {
							return new Response(err.message, { status: 401 });
						}
						context.logger.error("Unhandled error", { err });
						return new Response("Internal Server Error", { status: 500 });
					}

					const traceId = request.headers.get("x-trace-id") ?? ulid();
					const spanId = ulid();
					const organizationSessionContext: OrganizationSessionRequestContext = {
						type: "request",
						traceId,
						spanId,
						logger: context.logger.child({ method: request.method, url: request.url, traceId, spanId }),
						requestType: "authed",
						headers: request.headers,
						method: request.method,
						url: request.url,
						organizationId: authorization.organizationId,
						userId: authorization.userId,
						organizationRole: authorization.organizationRole,
					};

					const result = await rpcHandler.handle(request, {
						context: organizationSessionContext,
						prefix: "/dashboard",
					});
					return result.response ?? new Response("Not Found", { status: 404 });
				};
			})();
			handler = await createHandlerPromise;
			return handler(request);
		})();
	};
}

function organization(params: DashboardSessionIamParams): CreateOrganizationDashboardHandler {
	return (context) => createOrganizationHandler(params, context, authService(params));
}

function dashboardSessionIamFn(params: DashboardSessionIamParams): CreateDashboardIam {
	return (context): DashboardIam => {
		const getAuthService = authService(params);
		return {
			authenticator: createAuthenticator(getAuthService),
			organization: createOrganizationHandler(params, context, getAuthService),
		};
	};
}

export const dashboardSessionIam = Object.assign(dashboardSessionIamFn, {
	authenticator,
	organization,
});
