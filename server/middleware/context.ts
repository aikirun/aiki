import type { Logger } from "server/infra/logger";

import type { Authorization } from "./authorization";

interface ContextBase {
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
	organizationId: string;
	namespaceId: string;
	authMethod: "session" | "api_key";
}

export interface SessionAuthedRequestContext extends AuthedRequestContextBase {
	authMethod: "session";
	userId: string;
}

export interface ApiKeyAuthedRequestContext extends AuthedRequestContextBase {
	authMethod: "api_key";
}

export type AuthedRequestContext = SessionAuthedRequestContext | ApiKeyAuthedRequestContext;

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

export async function createAuthedRequestContext(params: {
	request: Request;
	logger: Logger;
	authorizer: (_: Request) => Promise<Authorization>;
}): Promise<AuthedRequestContext> {
	const { request, logger, authorizer: getAuthorization } = params;
	const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();

	const authorization = await getAuthorization(request);
	switch (authorization.method) {
		case "session":
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

				authMethod: "session",
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
