import { getRetryParams } from "./strategy";
import { describe, expect, spyOn, test } from "bun:test";

describe("getRetryParams", () => {
	describe("never strategy", () => {
		test("returns no retries left", () => {
			expect(getRetryParams(1, { type: "never" })).toEqual({ retriesLeft: false });
		});

		test("returns no retries left regardless of attempt count", () => {
			expect(getRetryParams(100, { type: "never" })).toEqual({ retriesLeft: false });
		});
	});

	describe("fixed strategy", () => {
		const strategy = { type: "fixed" as const, maxAttempts: 3, delayMs: 1000 };

		test("retries with configured delay when under max attempts", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 1000 });
		});

		test("returns same delay on every attempt", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 1000 });
			expect(getRetryParams(2, strategy)).toEqual({ retriesLeft: true, delayMs: 1000 });
		});

		test("stops retrying at max attempts", () => {
			expect(getRetryParams(3, strategy)).toEqual({ retriesLeft: false });
		});

		test("stops retrying beyond max attempts", () => {
			expect(getRetryParams(5, strategy)).toEqual({ retriesLeft: false });
		});
	});

	describe("exponential strategy", () => {
		const strategy = { type: "exponential" as const, maxAttempts: 5, baseDelayMs: 100 };

		test("uses base delay on first attempt", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 100 });
		});

		test("doubles (default factor) delay on each attempt", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(2, strategy)).toEqual({ retriesLeft: true, delayMs: 200 });
			expect(getRetryParams(3, strategy)).toEqual({ retriesLeft: true, delayMs: 400 });
		});

		test("uses custom factor", () => {
			const customFactorStrategy = { ...strategy, factor: 3 };
			expect(getRetryParams(1, customFactorStrategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(2, customFactorStrategy)).toEqual({ retriesLeft: true, delayMs: 300 });
			expect(getRetryParams(3, customFactorStrategy)).toEqual({ retriesLeft: true, delayMs: 900 });
		});

		test("caps delay at maxDelayMs", () => {
			const cappedDelayStrategy = { ...strategy, maxDelayMs: 300 };
			expect(getRetryParams(1, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(2, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 200 });
			expect(getRetryParams(3, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 300 });
			expect(getRetryParams(4, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 300 });
		});

		test("stops retrying at max attempts", () => {
			expect(getRetryParams(5, strategy)).toEqual({ retriesLeft: false });
		});
	});

	describe("jittered strategy", () => {
		const strategy = { type: "jittered" as const, maxAttempts: 5, baseDelayMs: 100 };

		test("returns delay between 0 and base on first attempt", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.5);
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 50 });
			mock.mockRestore();
		});

		test("scales jitter with attempt number using default factor", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.5);
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 50 });
			expect(getRetryParams(2, strategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(3, strategy)).toEqual({ retriesLeft: true, delayMs: 200 });
			mock.mockRestore();
		});

		test("uses custom factor", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.5);
			const customFactor = { ...strategy, factor: 3 };
			expect(getRetryParams(1, customFactor)).toEqual({ retriesLeft: true, delayMs: 50 });
			expect(getRetryParams(2, customFactor)).toEqual({ retriesLeft: true, delayMs: 150 });
			expect(getRetryParams(3, customFactor)).toEqual({ retriesLeft: true, delayMs: 450 });
			mock.mockRestore();
		});

		test("returns 0 delay when random returns 0", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0);
			const result = getRetryParams(1, strategy);
			expect(result).toEqual({ retriesLeft: true, delayMs: 0 });
			mock.mockRestore();
		});

		test("caps delay at maxDelayMs", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.9);
			const capped = { ...strategy, maxDelayMs: 50 };
			expect(getRetryParams(1, capped)).toEqual({ retriesLeft: true, delayMs: 50 });
			expect(getRetryParams(3, capped)).toEqual({ retriesLeft: true, delayMs: 50 });
			mock.mockRestore();
		});

		test("stops retrying at max attempts", () => {
			const result = getRetryParams(5, strategy);
			expect(result).toEqual({ retriesLeft: false });
		});
	});
});
