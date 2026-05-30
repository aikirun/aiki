import process from "node:process";
import { iam } from "@aikirun/iam";
import { redisCache, redisPublisher, redisTimerPriorityQueue } from "@aikirun/redis";
import { database, server } from "@aikirun/server";
import { Redis } from "ioredis";

import { loadConfig } from "./config/loader";
import { createCorsHelpers } from "./cors";
import { createLogger } from "./logger";

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

	const db = database(config.db);
	const cache = redis && redisCache(redis);

	const aiki = server({
		db,
		cache,
		logger,
		iam: iam({
			db,
			cache,
			secret: config.auth.secret,
			baseURL: config.baseURL,
			trustedOrigins: config.corsOrigins,
		}),
		runtime: {
			...(redis && {
				publisher: redisPublisher(redis),
				timerPriorityQueue: redisTimerPriorityQueue(redis, "aiki:timers"),
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
