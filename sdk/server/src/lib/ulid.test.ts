import { decodeTime, ulid } from "ulidx";

import { ulidUpperBound } from "./ulid";
import { describe, expect, test } from "bun:test";

describe("ulidUpperBound", () => {
	test("an id minted before the timestamp sorts below the upper bound", () => {
		const timestampMs = Date.now();
		const upperBoundId = ulidUpperBound(timestampMs);

		const olderId = ulid(timestampMs - 1);
		expect(olderId < upperBoundId).toBe(true);
	});

	test("an id minted exactly at the timestamp sorts at or below the upper bound (inclusive)", () => {
		const timestampMs = Date.now();
		const upperBoundId = ulidUpperBound(timestampMs);

		const id = ulid(timestampMs);
		expect(id <= upperBoundId).toBe(true);
	});

	test("an id minted after the timestamp sorts strictly above the upper bound", () => {
		const timestampMs = Date.now();
		const upperBoundId = ulidUpperBound(timestampMs);

		const newerId = ulid(timestampMs + 1);
		expect(newerId > upperBoundId).toBe(true);
	});

	test("upper bound id is a valid 26-character ULID-length string", () => {
		const upperBoundId = ulidUpperBound(Date.now());
		expect(upperBoundId).toHaveLength(26);
	});

	test("decodeTime returns the encoded timestamp", () => {
		const timestampMs = Date.now();
		const upperBoundId = ulidUpperBound(timestampMs);
		expect(decodeTime(upperBoundId)).toBe(timestampMs);
	});

	test("upper bound is monotonically increasing across timestamps", () => {
		const earlier = ulidUpperBound(1_000_000);
		const later = ulidUpperBound(1_000_001);
		expect(later > earlier).toBe(true);
	});
});
