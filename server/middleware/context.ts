import type { Logger } from "server/infra/logger";

import type {
	ApiKeyAuthorization,
	AuthorizationMethod,
	NamespaceSessionAuthorization,
	OrganizationSessionAuthorization,
} from "./authorization";

export interface ContextBase {
	type: "request" | "cron";
	traceId: string;
	logger: Logger;
}

export interface RequestContextBase extends ContextBase {
	type: "request";
	requestType: "public" | "authed";
	headers: Headers;
	method: string;
	url: string;
}

export interface PublicRequestContext extends RequestContextBase {
	requestType: "public";
}

export interface AuthedRequestContextBase extends RequestContextBase {
	requestType: "authed";
	authMethod: AuthorizationMethod;
}

export interface OrganizationSessionRequestContext extends AuthedRequestContextBase {
	authMethod: "organization_session";
	organizationId: string;
	userId: string;
}

export interface NamespaceSessionRequestContext extends AuthedRequestContextBase {
	authMethod: "namespace_session";
	organizationId: string;
	namespaceId: string;
	userId: string;
}

export interface ApiKeyRequestContext extends AuthedRequestContextBase {
	authMethod: "api_key";
	organizationId: string;
	namespaceId: string;
}

export type OrganizationRequestContext = OrganizationSessionRequestContext;

export type NamespaceRequestContext = NamespaceSessionRequestContext | ApiKeyRequestContext;

export type AuthedRequestContext = OrganizationRequestContext | NamespaceRequestContext;

export type RequestContext = PublicRequestContext | AuthedRequestContext;

export interface CronContext extends ContextBase {
	type: "cron";
	name: string;
}

export type Context = RequestContext | CronContext;

export function createPublicRequestContext(params: { request: Request; logger: Logger }): PublicRequestContext {
	const { request, logger } = params;
	const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();
	return {
		type: "request",
		traceId,
		logger: logger.child({
			method: request.method,
			url: request.url,
			traceId,
		}),
		requestType: "public",
		headers: request.headers,
		method: request.method,
		url: request.url,
	};
}

export async function createOrganizationRequestContext(params: {
	request: Request;
	logger: Logger;
	authorizer: (_: Request) => Promise<OrganizationSessionAuthorization>;
}): Promise<OrganizationRequestContext> {
	const { request, logger, authorizer } = params;
	const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();
	const authorization = await authorizer(request);
	return {
		type: "request",
		traceId,
		logger: logger.child({
			method: request.method,
			url: request.url,
			traceId,
		}),
		requestType: "authed",
		headers: request.headers,
		method: request.method,
		url: request.url,

		authMethod: "organization_session",
		organizationId: authorization.organizationId,
		userId: authorization.userId,
	};
}

export async function createNamespaceRequestContext(params: {
	request: Request;
	logger: Logger;
	authorizer: (_: Request) => Promise<NamespaceSessionAuthorization | ApiKeyAuthorization>;
}): Promise<NamespaceRequestContext> {
	const { request, logger, authorizer } = params;
	const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();
	const authorization = await authorizer(request);

	switch (authorization.method) {
		case "namespace_session":
			return {
				type: "request",
				traceId,
				logger: logger.child({
					method: request.method,
					url: request.url,
					traceId,
				}),
				requestType: "authed",
				headers: request.headers,
				method: request.method,
				url: request.url,

				authMethod: "namespace_session",
				organizationId: authorization.organizationId,
				namespaceId: authorization.namespaceId,
				userId: authorization.userId,
			};
		case "api_key":
			return {
				type: "request",
				traceId,
				logger: logger.child({
					method: request.method,
					url: request.url,
					traceId,
				}),
				requestType: "authed",
				headers: request.headers,
				method: request.method,
				url: request.url,

				authMethod: "api_key",
				organizationId: authorization.organizationId,
				namespaceId: authorization.namespaceId,
			};
		default:
			return authorization satisfies never;
	}
}

export function createCronContext(params: { name: string; logger: Logger }): CronContext {
	const { name, logger } = params;
	const traceId = crypto.randomUUID();
	return {
		type: "cron",
		traceId,
		logger: logger.child({ cronName: name, traceId }),
		name,
	};
}
