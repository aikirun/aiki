import { EventEmitter } from "node:events";
import { createBinaryLatch, delay } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import type { Redis } from "ioredis";

import { attachConnectionSupervisor, connectionTracker, untilReadyHandshake } from "./connection";
import { describe, expect, test } from "bun:test";

function fakeRedis(status: Redis["status"], connectTimeoutMs?: number) {
	return Object.assign(new EventEmitter(), {
		status,
		options: { connectTimeout: connectTimeoutMs },
	}) as unknown as Redis;
}

describe("connectionTracker", () => {
	const optimisticStatuses = ["wait", "connecting", "connect", "ready"] as const;
	for (const status of optimisticStatuses) {
		test(`starts available for a connection in ${status}`, () => {
			expect(connectionTracker(fakeRedis(status)).isAvailable()).toBe(true);
		});
	}

	const pessimisticStatuses = ["reconnecting", "close", "end"] as const;
	for (const status of pessimisticStatuses) {
		test(`starts unavailable for a connection in ${status}`, () => {
			expect(connectionTracker(fakeRedis(status)).isAvailable()).toBe(false);
		});
	}

	test("close marks the connection unavailable and ready restores it", () => {
		const redis = fakeRedis("ready");
		const tracker = connectionTracker(redis);

		redis.emit("close");
		expect(tracker.isAvailable()).toBe(false);

		redis.emit("ready");
		expect(tracker.isAvailable()).toBe(true);
	});

	test("stays available through the ready grace and goes unavailable once it elapses", () => {
		const beforeConstruction = Date.now();
		const tracker = connectionTracker(fakeRedis("connecting", 5_000));
		const afterConstruction = Date.now();

		expect(tracker.isAvailable(beforeConstruction + 5_000)).toBe(true);
		expect(tracker.isAvailable(afterConstruction + 5_001)).toBe(false);
	});

	test("a ready event restores availability after the grace expired", () => {
		const redis = fakeRedis("connecting", 5_000);
		const tracker = connectionTracker(redis);
		const afterConstruction = Date.now();

		expect(tracker.isAvailable(afterConstruction + 5_001)).toBe(false);

		const beforeReady = Date.now();
		redis.emit("ready");
		expect(tracker.isAvailable(beforeReady + 5_000)).toBe(true);
	});

	test("the grace does not apply to a connection whose status is ready", () => {
		const tracker = connectionTracker(fakeRedis("ready", 5_000));

		expect(tracker.isAvailable(Date.now() + 60_000)).toBe(true);
	});

	test("assertIsAvailable throws only when the connection is unavailable", () => {
		const availableTracker = connectionTracker(fakeRedis("ready"));
		expect(() => availableTracker.assertIsAvailable()).not.toThrow();

		const unavailableTracker = connectionTracker(fakeRedis("end"));
		expect(() => unavailableTracker.assertIsAvailable()).toThrow("Redis connection unavailable");
	});

	test("returns the same tracker for the same client", () => {
		const redis = fakeRedis("connecting");

		expect(connectionTracker(redis)).toBe(connectionTracker(redis));
	});

	test("tracks each client independently", () => {
		const droppedRedis = fakeRedis("ready");
		const healthyRedis = fakeRedis("ready");
		const droppedTracker = connectionTracker(droppedRedis);
		const healthyTracker = connectionTracker(healthyRedis);

		droppedRedis.emit("close");

		expect(droppedTracker.isAvailable()).toBe(false);
		expect(healthyTracker.isAvailable()).toBe(true);
	});
});

describe("untilReadyHandshake", () => {
	test("resolves immediately when the connection is already ready", async () => {
		await untilReadyHandshake(fakeRedis("ready"));
	});

	test("resolves when the connection becomes ready", async () => {
		const redis = fakeRedis("connecting");
		const handshakeReadyPromise = untilReadyHandshake(redis);

		redis.emit("ready");

		await handshakeReadyPromise;
	});

	test("rejects when the connection closes before becoming ready", () => {
		const redis = fakeRedis("connecting");
		const handshakeReadyPromise = untilReadyHandshake(redis);

		redis.emit("close");

		expect(handshakeReadyPromise).rejects.toThrow("closed before completing the ready handshake");
	});

	test("removes both listeners after resolving", async () => {
		const redis = fakeRedis("connecting");
		const handshakeReadyPromise = untilReadyHandshake(redis);

		redis.emit("ready");
		await handshakeReadyPromise;

		expect(redis.listenerCount("ready")).toBe(0);
		expect(redis.listenerCount("close")).toBe(0);
	});

	test("removes both listeners after rejecting", async () => {
		const redis = fakeRedis("connecting");
		const handshakeReadyPromise = untilReadyHandshake(redis);

		redis.emit("close");
		expect(handshakeReadyPromise).rejects.toThrow();

		expect(redis.listenerCount("ready")).toBe(0);
		expect(redis.listenerCount("close")).toBe(0);
	});
});

describe("attachConnectionSupervisor", () => {
	function supervisedRedis(params?: { connectTimeout?: number }) {
		const disconnectCalls: boolean[] = [];
		const disconnected = createBinaryLatch();
		const redis = Object.assign(new EventEmitter(), {
			status: "wait" as Redis["status"],
			options: { connectTimeout: params?.connectTimeout },
			disconnect: (reconnect = false) => {
				disconnectCalls.push(reconnect);
				disconnected.signal();
			},
		}) as unknown as Redis;

		const warnMessages: string[] = [];
		const logger = {
			warn: (message: string) => {
				warnMessages.push(message);
			},
		} as unknown as Logger;

		return { redis, disconnectCalls, disconnected, warnMessages, logger };
	}

	test("forces a reconnect when the connect handshake stalls", async () => {
		const { redis, disconnectCalls, disconnected, warnMessages, logger } = supervisedRedis({ connectTimeout: 5 });
		attachConnectionSupervisor(redis, { logger });

		redis.emit("connect");
		await disconnected.wait();

		expect(disconnectCalls).toEqual([true]);
		expect(warnMessages).toEqual(["Redis connect handshake stalled, forcing reconnect"]);
	});

	test("forces the reconnect without a logger", async () => {
		const { redis, disconnectCalls, disconnected } = supervisedRedis({ connectTimeout: 5 });
		attachConnectionSupervisor(redis);

		redis.emit("connect");
		await disconnected.wait();

		expect(disconnectCalls).toEqual([true]);
	});

	test("ready within the connect timeout cancels the watchdog", async () => {
		const { redis, disconnectCalls, logger } = supervisedRedis({ connectTimeout: 5 });
		attachConnectionSupervisor(redis, { logger });

		redis.emit("connect");
		redis.emit("ready");
		await delay(25);

		expect(disconnectCalls).toEqual([]);
	});

	test("close cancels the watchdog and a new connect re-arms it once", async () => {
		const { redis, disconnectCalls, disconnected, logger } = supervisedRedis({ connectTimeout: 5 });
		attachConnectionSupervisor(redis, { logger });

		redis.emit("connect");
		redis.emit("close");
		redis.emit("connect");
		await disconnected.wait();
		await delay(25);

		expect(disconnectCalls).toEqual([true]);
	});

	test("detach cancels a pending watchdog and removes all listeners", async () => {
		const { redis, disconnectCalls, logger } = supervisedRedis({ connectTimeout: 5 });
		const connectionSupervisor = attachConnectionSupervisor(redis, { logger });

		redis.emit("connect");
		connectionSupervisor.detach();
		await delay(25);

		expect(disconnectCalls).toEqual([]);
		const events = ["error", "connect", "ready", "close"];
		expect(events.map((event) => redis.listenerCount(event))).toEqual([0, 0, 0, 0]);
	});

	test("installs an error listener so an error event cannot crash the process", () => {
		const { redis } = supervisedRedis();
		attachConnectionSupervisor(redis);

		expect(() => redis.emit("error", new Error("connection refused"))).not.toThrow();
	});
});
