import { noopLogger } from "@aikirun/lib/logger";
import { timerPriorityQueueTestSuite } from "@aikirun/testing/infra/timer";
import Redis from "ioredis";

import { redisTimerPriorityQueue } from "./priority-queue";
import { describe, expect, test } from "bun:test";

timerPriorityQueueTestSuite({ describe, test, expect }, async (fn) => {
	const abortController = new AbortController();
	try {
		const redisClient = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
		redisClient.on("error", () => {});
		try {
			const timersKey = "aiki:timers";
			await redisClient.del(timersKey, `${timersKey}:signal`);
			const queue = redisTimerPriorityQueue(
				redisClient,
				timersKey
			)({
				logger: noopLogger,
				signal: abortController.signal,
			});
			await fn(queue);
		} finally {
			await redisClient.quit();
		}
	} finally {
		abortController.abort();
	}
});
