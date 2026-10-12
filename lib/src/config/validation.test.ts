import { describe, expect, test } from "vitest";

import { validateNoNaN } from "./validation";

describe("validateNoNaN", () => {
	test("accepts a config holding no NaN", () => {
		expect(validateNoNaN({ polling: { intervalMs: 1_000 } })).toEqual({ valid: true });
	});

	test("accepts a config holding Infinity", () => {
		expect(validateNoNaN({ backoff: { maxDelayMs: Number.POSITIVE_INFINITY } })).toEqual({ valid: true });
	});

	test("accepts a config that refers back to itself", () => {
		const config: { polling: { intervalMs: number; parent?: unknown } } = { polling: { intervalMs: 1_000 } };
		config.polling.parent = config;

		expect(validateNoNaN(config)).toEqual({ valid: true });
	});

	test("accepts a config nested deeper than the call stack allows", () => {
		let config: object = { intervalMs: 1_000 };
		for (let depth = 0; depth < 100_000; depth++) {
			config = { nested: config };
		}

		expect(validateNoNaN(config)).toEqual({ valid: true });
	});

	test("rejects a config, naming the setting that is NaN", () => {
		expect(validateNoNaN({ polling: { intervalMs: 1_000, chunk: { size: Number.NaN } } })).toEqual({
			valid: false,
			reason: "polling.chunk.size is NaN",
		});
	});
});
