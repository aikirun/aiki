export interface ServerContext {
	request: {
		headers: Headers;
		url: string;
		method: string;
	};
}

export function contextFactory(req: Request): ServerContext {
	return {
		request: {
			headers: req.headers,
			url: req.url,
			method: req.method,
		},
	};
}
