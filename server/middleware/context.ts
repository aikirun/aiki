import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import type { Logger } from "server/infra/logger";
import { ulid } from "ulidx";

import type {
	ApiKeyAuthorization,
	AuthorizationMethod,
	NamespaceSessionAuthorization,
	OrganizationSessionAuthorization,
} from "./authorization";

export interface ContextBase {
	type: "request" | "cron";
	traceId: string;
	spanId: string;
	logger: Logger;
	signal?: AbortSignal;
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
	organizationId: OrganizationId;
	userId: string;
}

export interface NamespaceSessionRequestContext extends AuthedRequestContextBase {
	authMethod: "namespace_session";
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
	userId: string;
}

export interface ApiKeyRequestContext extends AuthedRequestContextBase {
	authMethod: "api_key";
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
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
	const traceId = request.headers.get("x-trace-id") ?? ulid();
	const spanId = ulid();
	return {
		type: "request",
		traceId,
		spanId,
		logger: logger.child({
			method: request.method,
			url: request.url,
			traceId,
			spanId,
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
	const traceId = request.headers.get("x-trace-id") ?? ulid();
	const spanId = ulid();
	const authorization = await authorizer(request);
	return {
		type: "request",
		traceId,
		spanId,
		logger: logger.child({
			method: request.method,
			url: request.url,
			traceId,
			spanId,
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
	const traceId = request.headers.get("x-trace-id") ?? ulid();
	const spanId = ulid();
	const authorization = await authorizer(request);

	switch (authorization.method) {
		case "namespace_session":
			return {
				type: "request",
				traceId,
				spanId,
				logger: logger.child({
					method: request.method,
					url: request.url,
					traceId,
					spanId,
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
				spanId,
				logger: logger.child({
					method: request.method,
					url: request.url,
					traceId,
					spanId,
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

export function createCronContext(params: { name: string; logger: Logger; signal?: AbortSignal }): CronContext {
	const { name, logger, signal } = params;
	const traceId = ulid();
	const spanId = ulid();
	return {
		type: "cron",
		traceId,
		spanId,
		logger: logger.child({ cronName: name, traceId, spanId }),
		name,
		signal,
	};
}

export function forkContext<TContext extends Context>(context: TContext): TContext {
	const spanId = ulid();
	return {
		...context,
		spanId,
		logger: context.logger.child({ spanId }),
	};
}
