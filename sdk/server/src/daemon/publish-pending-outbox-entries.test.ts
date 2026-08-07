import { computeRepublishBackoffMs } from "./publish-pending-outbox-entries";
import { describe, expect, test } from "bun:test";

describe("computeRepublishBackoffMs", () => {
	test("waits the elapsed durationSinceFirstPublish when within bounds", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const initialAttemptAt = 990_000;
		const now = 1_000_000;

		const result = computeRepublishBackoffMs({ now, initialAttemptAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(10_000);
	});

	test("clamps to baseDelayMs when the elapsed durationSinceFirstPublish is below it", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const initialAttemptAt = 999_000;
		const now = 1_000_000;

		const result = computeRepublishBackoffMs({ now, initialAttemptAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(baseDelayMs);
	});

	test("clamps to maxDelayMs when the elapsed durationSinceFirstPublish exceeds it", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const initialAttemptAt = 600_000;
		const now = 1_000_000;

		const result = computeRepublishBackoffMs({ now, initialAttemptAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(maxDelayMs);
	});

	test("returns exactly maxDelayMs when the elapsed durationSinceFirstPublish equals the max", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const now = 1_000_000;
		const initialAttemptAt = now - maxDelayMs;

		const result = computeRepublishBackoffMs({ now, initialAttemptAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(maxDelayMs);
	});

	test("waits grow geometrically across undisturbed republish cycles until clamped at maxDelayMs", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 70_000;
		const initialAttemptAt = 0;

		// The first offer waits baseDelayMs (the caller's initial backoff); each republish then
		// happens when the previous wait elapses.
		let now = baseDelayMs;
		const backoffs: number[] = [];
		for (let cycle = 0; cycle < 5; cycle++) {
			const backoffMs = computeRepublishBackoffMs({ now, initialAttemptAt, baseDelayMs, maxDelayMs });
			backoffs.push(backoffMs);
			now += backoffMs;
		}

		expect(backoffs).toEqual([5_000, 10_000, 20_000, 40_000, 70_000]);
	});
});
