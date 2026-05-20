import process from "node:process";
import { redisCache, redisPublisher, redisTimerSortedSet } from "@aikirun/redis";
import { Redis } from "ioredis";

import { loadConfig } from "./config/index";
import { createLogger } from "./infra/logger";
import { server } from "./server";

if (import.meta.main) {
	const config = await loadConfig();
	const logger = createLogger(config.logLevel, config.prettyLogs);

	let redis: Redis | undefined;
	if (config.redis) {
		redis = new Redis({
			host: config.redis.host,
			port: config.redis.port,
			password: config.redis.password,
		});
		redis.on("error", (err: Error) => {
			logger.error("Redis connection error", { err });
		});
	}

	const aiki = server({
		db: config.database,
		logger,
		handler: {
			auth: {
				secret: config.auth.secret,
				baseURL: config.baseURL,
				trustedOrigins: config.corsOrigins,
			},
			...(redis && { cache: redisCache(redis) }),
		},
		runtime: {
			...(redis && {
				publisher: redisPublisher(redis),
				timerSortedSet: redisTimerSortedSet(redis, "aiki:timers"),
			}),
		},
	});

	const runtimeHandle = await aiki.runtime.start();

	const { createCorsResponse, withCorsHeaders } = createCorsHelpers(config.corsOrigins);

	Bun.serve({
		hostname: config.host,
		port: config.port,
		fetch: async (request) => {
			if (request.method === "OPTIONS") {
				return createCorsResponse(request);
			}
			const response = await aiki.handler(request);
			return withCorsHeaders(request, response);
		},
	});

	let shutdownPromise: Promise<void> | undefined;
	const shutdown = () => {
		if (!shutdownPromise) {
			shutdownPromise = (async () => {
				await runtimeHandle.stop();
				if (redis) {
					await redis.quit();
				}
				process.exit(0);
			})();
		}
		return shutdownPromise;
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	logger.info(`Server running on ${config.host}:${config.port}`);
}

function createCorsHelpers(corsOrigins: string[]) {
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
