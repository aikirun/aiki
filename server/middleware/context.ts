import type { Logger } from "../logger/index";

export interface ServerContext {
	request: {
		headers: Headers;
		url: string;
		method: string;
	};
	logger: Logger;
}

export function contextFactory(req: Request, logger: Logger): ServerContext {
	const requestLogger = logger.child({
		method: req.method,
		url: req.url,
	});

	return {
		request: {
			headers: req.headers,
			url: req.url,
			method: req.method,
		},
		logger: requestLogger,
	};
}
