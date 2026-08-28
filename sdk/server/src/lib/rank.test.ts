import { computeRank, extractRankDueAtMs, extractRankPriority } from "./rank";
import { describe, expect, test } from "bun:test";

describe("computeRank", () => {
	test("encodes the due time in the high digits and the priority in the low digit", () => {
		expect(computeRank({ dueAt: 1_000, priority: 7 })).toBe(10_007);
	});

	test("defaults to the mid-scale priority digit", () => {
		expect(computeRank({ dueAt: 1_000 })).toBe(10_005);
	});

	test("an earlier due time outranks any later one regardless of priority", () => {
		expect(computeRank({ dueAt: 1_000, priority: 9 })).toBeLessThan(computeRank({ dueAt: 1_001, priority: 0 }));
	});

	test("stays exact at real millisecond-timestamp scale", () => {
		const dueAt = 1_754_000_000_000;
		const rank = computeRank({ dueAt, priority: 3 });

		expect(extractRankDueAtMs(rank)).toBe(dueAt);
		expect(extractRankPriority(rank)).toBe(3);
	});
});

describe("extractRankDueAtMs", () => {
	test("recovers the due time from a rank", () => {
		expect(extractRankDueAtMs(10_005)).toBe(1_000);
	});
});

describe("extractRankPriority", () => {
	test("recovers the priority digit from a rank", () => {
		expect(extractRankPriority(10_005)).toBe(5);
	});
});
