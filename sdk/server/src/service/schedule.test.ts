import { getDueOccurrences } from "./schedule";
import { describe, expect, test } from "bun:test";

describe("getDueOccurrences", () => {
	const timestampMs = (iso: string) => new Date(iso).getTime();

	// Hourly on the hour, with 01:00 the next run still owed.
	const nextRunAt = timestampMs("2026-01-01T01:00:00Z");
	const hourlyCron = { type: "cron", expression: "0 * * * *", timezone: "UTC" } as const;
	const hourlyInterval = { type: "interval", everyMs: 60 * 60 * 1_000 } as const;

	test("skip policy: only the most recent missed occurrence is due, and nextRunAt is the one after it", () => {
		expect(getDueOccurrences({ spec: hourlyCron, nextRunAt }, timestampMs("2026-01-01T03:15:00Z"))).toEqual({
			occurrences: [timestampMs("2026-01-01T03:00:00Z")],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
		expect(getDueOccurrences({ spec: hourlyInterval, nextRunAt }, timestampMs("2026-01-01T03:15:00Z"))).toEqual({
			occurrences: [timestampMs("2026-01-01T03:00:00Z")],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
	});

	test("cancel_previous policy: same as skip, only the most recent missed occurrence is due", () => {
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyCron, overlapPolicy: "cancel_previous" }, nextRunAt },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toEqual({
			occurrences: [timestampMs("2026-01-01T03:00:00Z")],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyInterval, overlapPolicy: "cancel_previous" }, nextRunAt },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toEqual({
			occurrences: [timestampMs("2026-01-01T03:00:00Z")],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
	});

	test("allow policy: every occurrence from the next run is due, oldest first, and nextRunAt follows the last", () => {
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyCron, overlapPolicy: "allow" }, nextRunAt },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toEqual({
			occurrences: [
				timestampMs("2026-01-01T01:00:00Z"),
				timestampMs("2026-01-01T02:00:00Z"),
				timestampMs("2026-01-01T03:00:00Z"),
			],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyInterval, overlapPolicy: "allow" }, nextRunAt },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toEqual({
			occurrences: [
				timestampMs("2026-01-01T01:00:00Z"),
				timestampMs("2026-01-01T02:00:00Z"),
				timestampMs("2026-01-01T03:00:00Z"),
			],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
	});

	test("the next run itself is due when now equals it exactly", () => {
		const exactNextRunAt = timestampMs("2026-01-01T03:00:00Z");
		expect(getDueOccurrences({ spec: hourlyCron, nextRunAt: exactNextRunAt }, exactNextRunAt)).toEqual({
			occurrences: [exactNextRunAt],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
		expect(
			getDueOccurrences({ spec: { ...hourlyCron, overlapPolicy: "allow" }, nextRunAt: exactNextRunAt }, exactNextRunAt)
		).toEqual({
			occurrences: [exactNextRunAt],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
	});

	test("returns null while the next run is still ahead", () => {
		expect(getDueOccurrences({ spec: hourlyCron, nextRunAt }, timestampMs("2026-01-01T00:45:00Z"))).toBeNull();
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyCron, overlapPolicy: "allow" }, nextRunAt },
				timestampMs("2026-01-01T00:45:00Z")
			)
		).toBeNull();
		expect(getDueOccurrences({ spec: hourlyInterval, nextRunAt }, timestampMs("2026-01-01T00:45:00Z"))).toBeNull();
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyInterval, overlapPolicy: "allow" }, nextRunAt },
				timestampMs("2026-01-01T00:45:00Z")
			)
		).toBeNull();
	});
});
