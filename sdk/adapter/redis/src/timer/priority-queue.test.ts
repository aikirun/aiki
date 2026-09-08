import { EventEmitter } from "node:events";
import { noopLogger } from "@aikirun/lib/logger";
import type { Redis } from "ioredis";

import { redisTimerPriorityQueue } from "./priority-queue";
import { describe, expect, test } from "bun:test";

function fakeRedis(options: { lazyConnect: boolean }) {
	const duplicateOverrides: unknown[] = [];
	const redis = Object.assign(new EventEmitter(), {
		status: "wait" as Redis["status"],
		options,
		duplicate: (override: object) => {
			duplicateOverrides.push(override);
			return Object.assign(new EventEmitter(), {
				status: "wait" as Redis["status"],
				options: { ...options, ...override },
			}) as unknown as Redis;
		},
	}) as unknown as Redis;

	return { redis, duplicateOverrides };
}

describe("redisTimerPriorityQueue", () => {
	test("the waiter's connection does not inherit lazyConnect from the client it duplicates", () => {
		const { redis, duplicateOverrides } = fakeRedis({ lazyConnect: true });

		redisTimerPriorityQueue(redis, "aiki:timers:test")({ logger: noopLogger }).createWaiter();

		expect(duplicateOverrides).toEqual([{ maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: false }]);
	});
});
