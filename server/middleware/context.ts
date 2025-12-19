import type { Logger } from "../logger/index";

type ContextType = "request" | "cron";

interface BaseContext {
	type: ContextType;
	traceId: string;
	logger: Logger;
}

export interface RequestContext extends BaseContext {
	type: "request";
	headers: Headers;
	url: string;
	method: string;
}

export interface CronContext extends BaseContext {
	type: "cron";
	name: string;
}

export type ServerContext = RequestContext | CronContext;

export type CreateContextParams =
	| {
			type: "request";
			request: Request;
			logger: Logger;
	  }
	| {
			type: "cron";
			name: string;
			logger: Logger;
	  };

export function createContext(params: CreateContextParams): ServerContext {
	if (params.type === "request") {
		const { request } = params;
		const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();
		return {
			type: "request",
			traceId,
			logger: params.logger.child({
				method: request.method,
				url: request.url,
				traceId,
			}),
			headers: request.headers,
			url: request.url,
			method: request.method,
		};
	}

	const { name } = params;
	const traceId = crypto.randomUUID();
	return {
		type: "cron",
		traceId,
		logger: params.logger.child({
			cronName: name,
			traceId,
		}),
		name,
	};
}
