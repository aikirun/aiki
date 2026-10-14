import { describe, expect, test } from "vitest";

import { withFakeClock } from "./clock";

describe("withFakeClock", () => {
	test("goes back to the outer frozen time when a nested freeze ends", async () => {
		const clockReadings = await withFakeClock(1_000, async () => {
			const nowInNestedFreeze = await withFakeClock(2_000, async () => Date.now());
			return { nowInNestedFreeze, nowAfterNestedFreeze: Date.now() };
		});

		expect(clockReadings).toEqual({ nowInNestedFreeze: 2_000, nowAfterNestedFreeze: 1_000 });
	});
});
