import type { Logger } from "@aikirun/lib/logger";

export interface ContextBase {
	type: "request" | "daemon";
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

export interface AuthedRequestContextBase extends RequestContextBase {
	requestType: "authed";
}
