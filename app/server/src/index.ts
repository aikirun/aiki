import process from "node:process";
import { iam } from "@aikirun/iam";
import type { Logger } from "@aikirun/lib/logger";
import { attachConnectionSupervisor, redisCache, redisPublisher, redisTimerPriorityQueue } from "@aikirun/redis";
import { database, server } from "@aikirun/server";
import { Redis } from "ioredis";

import { loadConfig } from "./config/loader";
import type { RedisConfig } from "./config/schema";
import { createCorsHelpers } from "./cors";
import { createLogger } from "./logger";

if (import.meta.main) {
	const config = await loadConfig();
	const logger = createLogger(config.logLevel, config.prettyLogs);

	const redis = config.redis && createRedis(config.redis, logger);

	const db = database(config.db);
	const cache = redis && redisCache(redis.client);

	const aiki = server({
		db,
		logger,
		handler: {
			cache,
			iam:
				config.auth && config.baseURL
					? iam({
							db,
							cache,
							secret: config.auth.secret,
							baseURL: config.baseURL,
							trustedOrigins: config.corsOrigins,
						})
					: undefined,
		},
		runtime: {
			...(redis && {
				publisher: redisPublisher(redis.client),
				timerPriorityQueue: redisTimerPriorityQueue(redis.client, "aiki:timers"),
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
				if (redis) {
					redis.close();
				}
				await runtimeHandle.stop();
				process.exit(0);
			})();
		}
		return shutdownPromise;
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	logger.info(`Server running on ${config.host}:${config.port}`);
}

function createRedis(config: RedisConfig, logger: Logger) {
	const redis = new Redis({
		host: config.host,
		port: config.port,
		password: config.password,
	});
	const connectionSupervisor = attachConnectionSupervisor(redis, { logger });

	type State =
		| { status: "connecting"; errorReported: boolean }
		| { status: "connected" }
		| { status: "disconnected"; errorReported: boolean };

	let currentState: State = { status: "connecting", errorReported: false };

	redis.on("ready", () => {
		if (currentState.status === "connecting") {
			logger.info("Redis connection established");
		} else if (currentState.status === "disconnected") {
			logger.info("Redis connection restored");
		}
		currentState = { status: "connected" };
	});
	// A clean disconnect emits "close" without ever emitting "error" — the
	// first "error" only arrives once a reconnect attempt fails at the
	// socket level, which can take up to connectTimeout per attempt.
	redis.on("close", () => {
		if (currentState.status === "connected") {
			logger.warn("Redis connection lost");
			currentState = { status: "disconnected", errorReported: false };
		}
	});
	redis.on("error", (err: Error) => {
		if (currentState.status === "connected") {
			logger.error("Redis connection error", { err });
			currentState = { status: "disconnected", errorReported: true };
		} else if (!currentState.errorReported) {
			logger.error("Redis connection error", { err });
			currentState.errorReported = true;
		}
	});

	return {
		client: redis,
		close() {
			connectionSupervisor.detach();
			redis.disconnect();
		},
	};
}
