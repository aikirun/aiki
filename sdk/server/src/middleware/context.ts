import type { AuthedRequestContextBase, ContextBase, PublicRequestContext } from "@aikirun/lib/context";
import type { Logger } from "@aikirun/lib/logger";
import type { ApiAuthorizer } from "@aikirun/types/iam";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import { ulid } from "ulidx";

export interface NamespaceRequestContext extends AuthedRequestContextBase {
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
	userId?: string;
}

export type RequestContext = PublicRequestContext | NamespaceRequestContext;

export interface DaemonContext extends ContextBase {
	type: "daemon";
	name: string;
}

export type Context = RequestContext | DaemonContext;

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

export async function createNamespaceRequestContext(params: {
	request: Request;
	logger: Logger;
	authorizer: ApiAuthorizer;
}): Promise<NamespaceRequestContext> {
	const { request, logger, authorizer } = params;
	const traceId = request.headers.get("x-trace-id") ?? ulid();
	const spanId = ulid();
	const authorization = authorizer(request);
	const { organizationId, namespaceId, userId } =
		authorization instanceof Promise ? await authorization : authorization;

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
		organizationId,
		namespaceId,
		userId,
	};
}

export function createDaemonContext(params: { name: string; logger: Logger; signal?: AbortSignal }): DaemonContext {
	const { name, logger, signal } = params;
	const traceId = ulid();
	const spanId = ulid();
	return {
		type: "daemon",
		traceId,
		spanId,
		logger: logger.child({ daemonName: name, traceId, spanId }),
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
