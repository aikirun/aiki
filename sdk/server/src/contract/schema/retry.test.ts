import { type } from "arktype";
import { describe, expect, test } from "vitest";

import { retryStrategySchema } from "./retry";

describe("retryStrategySchema", () => {
	test("accepts a fractional factor on an exponential strategy", () => {
		const strategy = { type: "exponential" as const, maxAttempts: 3, baseDelayMs: 100, factor: 1.5 };
		expect(retryStrategySchema(strategy)).toEqual(strategy);
	});

	test("accepts a fractional factor on a jittered strategy", () => {
		const strategy = { type: "jittered" as const, maxAttempts: 3, baseDelayMs: 100, factor: 1.5 };
		expect(retryStrategySchema(strategy)).toEqual(strategy);
	});

	test("rejects a factor below 1 on an exponential strategy", () => {
		const strategy = { type: "exponential" as const, maxAttempts: 3, baseDelayMs: 100, factor: 0.5 };
		expect(retryStrategySchema(strategy)).toBeInstanceOf(type.errors);
	});

	test("rejects a factor below 1 on a jittered strategy", () => {
		const strategy = { type: "jittered" as const, maxAttempts: 3, baseDelayMs: 100, factor: 0.5 };
		expect(retryStrategySchema(strategy)).toBeInstanceOf(type.errors);
	});
});
