import type { Logger } from "../logger";

export interface ContextBase {
	type: string;
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
}
