import { describe, expect, test } from "vitest";

import { createAsyncLruCache } from "./async-lru";

describe("createAsyncLruCache", () => {
	test("deduplicates concurrent creates for the same key", async () => {
		let createCount = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const cache = createAsyncLruCache<number>({ maxEntries: 8, ttlMs: null });

		const first = cache.getOrCreate("a", async () => {
			createCount += 1;
			await gate;
			return 1;
		});
		const second = cache.getOrCreate("a", async () => {
			createCount += 1;
			return 2;
		});

		release();
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
