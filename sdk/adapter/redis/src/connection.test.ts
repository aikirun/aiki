import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";

import { untilReadyHandshake } from "./connection";
import { describe, expect, test } from "bun:test";

function fakeRedis(status: "connecting" | "ready") {
	return Object.assign(new EventEmitter(), { status }) as unknown as Redis;
}

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
