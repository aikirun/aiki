import { type } from "arktype";
import { describe, expect, test } from "vitest";

import { validateAgainstSchema } from "./validate";

describe("validateAgainstSchema", () => {
	const pollingConfigSchema = type({
		polling: {
			intervalMs: "number.integer > 0",
			pageSize: "number.integer > 0",
		},
	});

	test("names every invalid setting", () => {
		expect(
			validateAgainstSchema(pollingConfigSchema, { polling: { intervalMs: -5_000, pageSize: Number.NaN } })
		).toEqual({
			valid: false,
			reason: expect.stringMatching(/^polling\.intervalMs [^;]+; polling\.pageSize [^;]+$/),
		});
	});
});
