export function createCorsHelpers(corsOrigins: string[]) {
	function getCorsHeaders(request: Request): Record<string, string> {
		const origin = request.headers.get("origin") || "";
		const allowedOrigin = corsOrigins.includes(origin) ? origin : "";
		return {
			"Access-Control-Allow-Origin": allowedOrigin,
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, x-trace-id, Accept",
			"Access-Control-Allow-Credentials": "true",
		};
	}

	function createCorsResponse(request: Request): Response {
		return new Response(null, { status: 204, headers: getCorsHeaders(request) });
	}

	function withCorsHeaders(request: Request, response: Response): Response {
		for (const [key, value] of Object.entries(getCorsHeaders(request))) {
			response.headers.set(key, value);
		}
		return response;
	}

	return { createCorsResponse, withCorsHeaders };
}
