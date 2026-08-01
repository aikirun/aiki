import { computeRepublishBackoff } from "./publish-ready-runs";
import { describe, expect, test } from "bun:test";

describe("computeRepublishBackoff", () => {
	test("waits the elapsed durationSinceFirstPublish when within bounds", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const firstPublishedAt = 990_000;
		const now = 1_000_000;

		const result = computeRepublishBackoff({ now, firstPublishedAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(now + (now - firstPublishedAt));
	});

	test("clamps to baseDelayMs when the elapsed durationSinceFirstPublish is below it", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const firstPublishedAt = 999_000;
		const now = 1_000_000;

		const result = computeRepublishBackoff({ now, firstPublishedAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(now + baseDelayMs);
	});

	test("clamps to maxDelayMs when the elapsed durationSinceFirstPublish exceeds it", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const firstPublishedAt = 600_000;
		const now = 1_000_000;

		const result = computeRepublishBackoff({ now, firstPublishedAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(now + maxDelayMs);
	});

	test("returns exactly now + maxDelayMs when the elapsed durationSinceFirstPublish equals the max", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 300_000;
		const now = 1_000_000;
		const firstPublishedAt = now - maxDelayMs;

		const result = computeRepublishBackoff({ now, firstPublishedAt, baseDelayMs, maxDelayMs });

		expect(result).toBe(now + maxDelayMs);
	});

	test("waits grow geometrically across undisturbed republish cycles until clamped at maxDelayMs", () => {
		const baseDelayMs = 5_000;
		const maxDelayMs = 70_000;
		const firstPublishedAt = 0;

		// The first offer waits baseDelayMs (the caller's initial backoff); each republish then
		// happens when the previous wait elapses.
		let now = baseDelayMs;
		const waits: number[] = [];
		for (let cycle = 0; cycle < 5; cycle++) {
			const nextPublishAttemptAt = computeRepublishBackoff({ now, firstPublishedAt, baseDelayMs, maxDelayMs });
			waits.push(nextPublishAttemptAt - now);
			now = nextPublishAttemptAt;
		}

		expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 70_000]);
	});
});
