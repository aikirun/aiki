import { noopLogger } from "@aikirun/lib/logger";
import { timerPriorityQueueTestSuite } from "@aikirun/testing/infra/timer";
import Redis from "ioredis";
import { describe, expect, test } from "vitest";

import { getTimerKeys } from "./key";
import { redisTimerPriorityQueue } from "./priority-queue";

timerPriorityQueueTestSuite({ describe, test, expect }, async (fn) => {
	const abortController = new AbortController();
	try {
		const redisClient = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
		redisClient.on("error", () => {});
		try {
			const key = "aiki:timers:test";
			const { timersKey, signalKey } = getTimerKeys(key);
			await redisClient.del(timersKey, signalKey);
			const queue = redisTimerPriorityQueue(
				redisClient,
				key
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

describe("redisTimerPriorityQueue signals", () => {
	test("several adds behind an overdue current earliest leave one signal pending", async () => {
		const redisClient = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
		redisClient.on("error", () => {});
		try {
			const key = "aiki:timers:test";
			const { timersKey, signalKey } = getTimerKeys(key);
			await redisClient.del(timersKey, signalKey);
			const queue = redisTimerPriorityQueue(redisClient, key)({ logger: noopLogger });

			await queue.add({ timers: [{ type: "sleep", id: "timer-a", rank: 10 }], overdueRank: 0 });
			// The first add's own signal, taken the way a waiter would have taken it.
			await redisClient.del(signalKey);

			await queue.add({ timers: [{ type: "retry", id: "timer-b", rank: 20 }], overdueRank: 10 });
			await queue.add({ timers: [{ type: "scheduled", id: "timer-c", rank: 30 }], overdueRank: 10 });

			expect(await redisClient.lrange(signalKey, 0, -1)).toEqual(["10"]);
		} finally {
			await redisClient.quit();
		}
	});
});
