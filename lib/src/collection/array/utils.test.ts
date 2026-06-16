import { chunkLazy, groupBy, isNonEmptyArray, partitionArray, shuffleArray } from "./utils";
import { describe, expect, spyOn, test } from "bun:test";

describe("isNonEmptyArray", () => {
	test("returns true for array with elements", () => {
		expect(isNonEmptyArray([1, 2, 3])).toBe(true);
	});

	test("returns true for single-element array", () => {
		expect(isNonEmptyArray([1])).toBe(true);
	});

	test("returns false for empty array", () => {
		expect(isNonEmptyArray([])).toBe(false);
	});

	test("returns false for undefined", () => {
		expect(isNonEmptyArray(undefined)).toBe(false);
	});
});

describe("groupBy", () => {
	test("groups items by key", () => {
		const items = [
			{ name: "alice", role: "admin" },
			{ name: "bob", role: "user" },
			{ name: "charlie", role: "admin" },
		];
		const result = groupBy(items, (item) => [item.role, item.name]);
		expect(result.get("admin")).toEqual(["alice", "charlie"]);
		expect(result.get("user")).toEqual(["bob"]);
	});

	test("returns empty map for empty input", () => {
		const result = groupBy([], (item: string) => [item, item]);
		expect(result.size).toBe(0);
	});

	test("puts all items under one key when they share a key", () => {
		const result = groupBy([1, 2, 3], (item) => ["all", item]);
		expect(result.get("all")).toEqual([1, 2, 3]);
	});
});

describe("chunkLazy", () => {
	test("splits array into chunks of given size", () => {
		const chunks = Array.from(chunkLazy([1, 2, 3, 4, 5], 2));
		expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
	});

	test("returns single chunk when size exceeds array length", () => {
		const chunks = Array.from(chunkLazy([1, 2], 10));
		expect(chunks).toEqual([[1, 2]]);
	});

	test("returns empty iterator for empty array", () => {
		const chunks = Array.from(chunkLazy([], 3));
		expect(chunks).toEqual([]);
	});

	test("returns chunks of size 1", () => {
		const chunks = Array.from(chunkLazy([1, 2, 3], 1));
		expect(chunks).toEqual([[1], [2], [3]]);
	});
});

describe("partitionArray", () => {
	test("splits items by condition", () => {
		const result = partitionArray([1, 2, 3, 4, 5], (item) => ({ meetsCondition: item % 2 === 0, item }));
		expect(result.whenTrue).toEqual([2, 4]);
		expect(result.whenFalse).toEqual([1, 3, 5]);
	});

	test("returns empty arrays for empty input", () => {
		const result = partitionArray([], (item: number) => ({ meetsCondition: true, item }));
		expect(result.whenTrue).toEqual([]);
		expect(result.whenFalse).toEqual([]);
	});

	test("all items meet condition", () => {
		const result = partitionArray([1, 2, 3], (item) => ({ meetsCondition: true, item }));
		expect(result.whenTrue).toEqual([1, 2, 3]);
		expect(result.whenFalse).toEqual([]);
	});

	test("transforms items during partition", () => {
		const result = partitionArray<string, string, number>(["hello", "ab", "world"], (item) =>
			item.length > 3
				? { meetsCondition: true, item: item.toUpperCase() }
				: { meetsCondition: false, item: item.length }
		);
		expect(result.whenTrue).toEqual(["HELLO", "WORLD"]);
		expect(result.whenFalse).toEqual([2]);
	});
});

describe("shuffleArray", () => {
	test("returns a new array", () => {
		const original = [1, 2, 3];
		const shuffled = shuffleArray(original);
		expect(shuffled).not.toBe(original);
	});

	test("does not mutate the original array", () => {
		const original = [1, 2, 3];
		shuffleArray(original);
		expect(original).toEqual([1, 2, 3]);
	});

	test("preserves all elements", () => {
		const original = [1, 2, 3, 4, 5];
		const shuffled = shuffleArray(original);
		expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
	});

	test("returns empty array for empty input", () => {
		expect(shuffleArray([])).toEqual([]);
	});

	test("returns single-element array unchanged", () => {
		expect(shuffleArray([42])).toEqual([42]);
	});

	test("produces deterministic output with mocked random", () => {
		const mock = spyOn(Math, "random").mockReturnValue(0);
		const result = shuffleArray([1, 2, 3]);
		expect(result).toEqual([2, 3, 1]);
		mock.mockRestore();
	});
});
