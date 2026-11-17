import { describe, expect, test } from "vitest";

import { createAsyncLruCache } from "./async-lru";
import { createBinaryLatch } from "../async";

describe("createAsyncLruCache", () => {
	test("deduplicates concurrent creates for the same key", async () => {
		let createCount = 0;
		const gate = createBinaryLatch();
		const cache = createAsyncLruCache<number>({ maxEntries: 8, ttlMs: null });

		const first = cache.getOrCreate("a", async () => {
			createCount += 1;
			await gate.wait();
			return 1;
		});
		const second = cache.getOrCreate("a", async () => {
			createCount += 1;
			return 2;
		});

		gate.signal();
		const [valueA, valueB] = await Promise.all([first, second]);
		expect(createCount).toBe(1);
		expect(valueA).toBe(1);
		expect(valueB).toBe(1);
	});

	test("does not retain a rejected create", async () => {
		const cache = createAsyncLruCache<number>({ maxEntries: 8, ttlMs: null });
		let attempt = 0;

		await expect(
			cache.getOrCreate("a", async () => {
				attempt += 1;
				throw new Error("vault down");
			})
		).rejects.toThrow("vault down");

		const value = await cache.getOrCreate("a", async () => {
			attempt += 1;
			return 7;
		});
		expect(attempt).toBe(2);
		expect(value).toBe(7);
	});

	test("evicts the least recently used ready entry when full", async () => {
		const cache = createAsyncLruCache<string>({ maxEntries: 1, ttlMs: null });
		const creates: string[] = [];

		await cache.getOrCreate("a", async () => {
			creates.push("a");
			return "a";
		});
		await cache.getOrCreate("b", async () => {
			creates.push("b");
			return "b";
		});
		await cache.getOrCreate("a", async () => {
			creates.push("a");
			return "a";
		});

		expect(creates).toEqual(["a", "b", "a"]);
	});

	test("evicts the oldest in-flight entry so the limit holds and the newest finish is cached", async () => {
		const cache = createAsyncLruCache<string>({ maxEntries: 2, ttlMs: null });
		const creates: string[] = [];
		const gateA = createBinaryLatch();
		const gateB = createBinaryLatch();
		const gateC = createBinaryLatch();

		const promiseA = cache.getOrCreate("a", async () => {
			creates.push("a");
			await gateA.wait();
			return "a";
		});
		const promiseB = cache.getOrCreate("b", async () => {
			creates.push("b");
			await gateB.wait();
			return "b";
		});
		const promiseC = cache.getOrCreate("c", async () => {
			creates.push("c");
			await gateC.wait();
			return "c";
		});

		gateC.signal();
		await expect(promiseC).resolves.toBe("c");

		await expect(
			cache.getOrCreate("c", async () => {
				creates.push("c-again");
				return "c-again";
			})
		).resolves.toBe("c");

		gateA.signal();
		gateB.signal();
		await expect(promiseA).resolves.toBe("a");
		await expect(promiseB).resolves.toBe("b");

		await expect(
			cache.getOrCreate("a", async () => {
				creates.push("a-again");
				return "a-again";
			})
		).resolves.toBe("a-again");

		expect(creates).toEqual(["a", "b", "c", "a-again"]);
	});

	test("ttlMs 0 treats every subsequent get as a miss", async () => {
		const cache = createAsyncLruCache<number>({ maxEntries: 8, ttlMs: 0 });
		let createCount = 0;

		await cache.getOrCreate("a", async () => {
			createCount += 1;
			return createCount;
		});
		await cache.getOrCreate("a", async () => {
			createCount += 1;
			return createCount;
		});

		expect(createCount).toBe(2);
	});
});
