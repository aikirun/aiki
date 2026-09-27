import { toMilliseconds } from "./convert";
import { describe, expect, test } from "bun:test";

describe("toMilliseconds", () => {
	describe("valid inputs", () => {
		test("converts days to milliseconds", () => {
			expect(toMilliseconds({ days: 1 })).toBe(86_400_000);
		});

		test("converts hours to milliseconds", () => {
			expect(toMilliseconds({ hours: 1 })).toBe(3_600_000);
		});

		test("converts minutes to milliseconds", () => {
			expect(toMilliseconds({ minutes: 1 })).toBe(60_000);
		});

		test("converts seconds to milliseconds", () => {
			expect(toMilliseconds({ seconds: 1 })).toBe(1_000);
		});

		test("passes through milliseconds field", () => {
			expect(toMilliseconds({ milliseconds: 500 })).toBe(500);
		});

		test("sums multiple fields", () => {
			expect(toMilliseconds({ minutes: 1, seconds: 30 })).toBe(90_000);
		});

		test("sums all fields", () => {
			const result = toMilliseconds({
				days: 1,
				hours: 2,
				minutes: 3,
				seconds: 4,
				milliseconds: 5,
			});
			expect(result).toBe(86_400_000 + 7_200_000 + 180_000 + 4_000 + 5);
		});

		test("accepts fractional values", () => {
			expect(toMilliseconds({ hours: 1.5 })).toBe(5_400_000);
		});

		test("accepts zero-valued fields", () => {
			expect(toMilliseconds({ hours: 0, minutes: 5 })).toBe(300_000);
		});
	});

	describe("invalid inputs", () => {
		test("throws on negative field with field name", () => {
			expect(() => toMilliseconds({ hours: -1 })).toThrow("'hours' duration must be non-negative. Received: -1");
		});

		test("throws on NaN field with field name", () => {
			expect(() => toMilliseconds({ seconds: NaN })).toThrow("'seconds' duration must be finite. Received: NaN");
		});

		test("throws on Infinity field with field name", () => {
			expect(() => toMilliseconds({ days: Infinity })).toThrow("'days' duration must be finite. Received: Infinity");
		});
	});
});
