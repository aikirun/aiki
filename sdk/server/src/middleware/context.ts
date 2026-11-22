import type {
	AuthedRequestContextBase,
	ContextBase,
	PublicRequestContext,
	RequestContextBase,
} from "@aikirun/lib/context";
import type { Logger } from "@aikirun/lib/logger";
import type { RequiredProp } from "@aikirun/lib/object";
import type { ApiAuthorization } from "@aikirun/types/iam";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import { ulid } from "ulidx";

export interface NamespaceRequestContext extends AuthedRequestContextBase {
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
	userId?: string;
}

export type RequestContext = PublicRequestContext | NamespaceRequestContext;

export interface DaemonContext extends RequiredProp<ContextBase, "signal"> {
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
			"aiki.method": request.method,
			"aiki.url": request.url,
			"aiki.traceId": traceId,
			"aiki.spanId": spanId,
		}),
		requestType: "public",
		headers: request.headers,
		method: request.method,
		url: request.url,
	};
}

export function createNamespaceRequestContext(params: {
	context: RequestContextBase;
	authorization: ApiAuthorization;
}): NamespaceRequestContext {
	const { context, authorization } = params;
	const { organizationId, namespaceId, userId } = authorization;
	return { ...context, requestType: "authed", organizationId, namespaceId, userId };
}

export function createDaemonContext(params: { name: string; logger: Logger; signal: AbortSignal }): DaemonContext {
	const { name, logger, signal } = params;
	const traceId = ulid();
	const spanId = ulid();
	return {
		type: "daemon",
		traceId,
		spanId,
		logger: logger.child({ "aiki.daemonName": name, "aiki.traceId": traceId, "aiki.spanId": spanId }),
		name,
		signal,
	};
}

export function forkContext<TContext extends Context>(context: TContext): TContext {
	const spanId = ulid();
	return {
		...context,
		spanId,
		logger: context.logger.child({ "aiki.spanId": spanId }),
	};
}
