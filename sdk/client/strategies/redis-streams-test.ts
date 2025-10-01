import { assertEquals, assertExists } from "https://deno.land/std@0.201.0/assert/mod.ts";
import { resolveSubscriberStrategy, type RedisStreamsSubscriberStrategy } from "./subscriber-strategies.ts";
import type { Client } from "../definition.ts";

// Mock client for testing
const mockClient = {
	getRedisConnection: () => ({
		xgroup: () => Promise.resolve(),
		xreadgroup: () => Promise.resolve([]),
		xpending: () => Promise.resolve([]),
		xclaim: () => Promise.resolve([]),
		xack: () => Promise.resolve(),
	}),
	workflowRunRepository: {},
} as any as Client;

// Mock registry for testing
const mockRegistry = {
	_internal: {
		getNames: () => ["user.signup", "payment.process"],
	},
} as any;

Deno.test("Redis Streams Strategy - Basic Creation", () => {
	const strategy: RedisStreamsSubscriberStrategy = {
		type: "redis_streams",
	};

	const resolved = resolveSubscriberStrategy(mockClient, strategy, mockRegistry);

	assertExists(resolved.init);
});

Deno.test("Redis Streams Strategy - Initialization", async () => {
	const strategy: RedisStreamsSubscriberStrategy = {
		type: "redis_streams",
	};

	const resolved = resolveSubscriberStrategy(mockClient, strategy, mockRegistry);
	const instance = await resolved.init("test-worker", {});

	// Test that instance has required methods
	assertExists(instance.getNextDelay);
	assertExists(instance.getNextBatch);
	assertEquals(instance.type, "redis_streams");
});

Deno.test("Redis Streams Strategy - Delay Calculations", async () => {
	const strategy: RedisStreamsSubscriberStrategy = {
		type: "redis_streams",
		intervalMs: 50,
		maxRetryIntervalMs: 30_000,
		atCapacityIntervalMs: 100,
	};

	const resolved = resolveSubscriberStrategy(mockClient, strategy, mockRegistry);
	const instance = await resolved.init("test-worker", {});

	// Test delay calculations
	assertEquals(instance.getNextDelay({ type: "polled", foundWork: true }), 50);
	assertEquals(instance.getNextDelay({ type: "polled", foundWork: false }), 50);
	assertEquals(instance.getNextDelay({ type: "heartbeat" }), 50);
	assertEquals(instance.getNextDelay({ type: "at_capacity" }), 100);
});