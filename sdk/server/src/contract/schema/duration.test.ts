import { type } from "arktype";
import { describe, expect, test } from "vitest";

import { durationObjectSchema } from "./duration";

describe("durationObjectSchema", () => {
	test("accepts a duration that sets one field", () => {
		expect(durationObjectSchema({ seconds: 5 })).toEqual({ seconds: 5 });
	});

	test("rejects a duration that sets no field, naming the fields it accepts", () => {
		const result = durationObjectSchema({});

		expect(result).toBeInstanceOf(type.errors);
		expect(String(result)).toBe(
			"must be a duration with at least one of days, hours, minutes, seconds or milliseconds (was {})"
		);
	});
});
