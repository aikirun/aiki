import { getDueOccurrences } from "./schedule";
import { describe, expect, test } from "bun:test";

describe("getDueOccurrences", () => {
	const timestampMs = (iso: string) => new Date(iso).getTime();

	// Hourly on the hour. Created at 00:30, so 01:00 is the first occurrence that can become due.
	const createdAt = timestampMs("2026-01-01T00:30:00Z");
	const hourlyCron = { type: "cron", expression: "0 * * * *", timezone: "UTC" } as const;
	const hourlyInterval = { type: "interval", everyMs: 60 * 60 * 1_000 } as const;

	test("skip policy: only the most recent missed occurrence is due, and nextRunAt is the one after it", () => {
		expect(getDueOccurrences({ spec: hourlyCron, createdAt }, timestampMs("2026-01-01T03:15:00Z"))).toEqual({
			occurrences: [timestampMs("2026-01-01T03:00:00Z")],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
	});

	test("cancel_previous policy: same as skip, only the most recent missed occurrence is due", () => {
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyCron, overlapPolicy: "cancel_previous" }, createdAt },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toEqual({
			occurrences: [timestampMs("2026-01-01T03:00:00Z")],
			nextRunAt: timestampMs("2026-01-01T04:00:00Z"),
		});
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyInterval, overlapPolicy: "cancel_previous" }, createdAt },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toEqual({
			occurrences: [timestampMs("2026-01-01T02:30:00Z")],
			nextRunAt: timestampMs("2026-01-01T03:30:00Z"),
		});
	});

	test("allow policy: every missed occurrence is due, oldest first, and nextRunAt follows the last", () => {
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyCron, overlapPolicy: "allow" }, createdAt },
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

	test("returns null when no occurrence has passed since the schedule was created", () => {
		expect(getDueOccurrences({ spec: hourlyCron, createdAt }, timestampMs("2026-01-01T00:45:00Z"))).toBeNull();
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyCron, overlapPolicy: "allow" }, createdAt },
				timestampMs("2026-01-01T00:45:00Z")
			)
		).toBeNull();
	});

	test("returns null when the most recent occurrence has already fired", () => {
		expect(
			getDueOccurrences(
				{ spec: hourlyCron, createdAt, lastOccurrence: timestampMs("2026-01-01T03:00:00Z") },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toBeNull();
	});

	test("interval specs: occurrences fall every everyMs after the anchor", () => {
		expect(getDueOccurrences({ spec: hourlyInterval, createdAt }, timestampMs("2026-01-01T03:15:00Z"))).toEqual({
			occurrences: [timestampMs("2026-01-01T02:30:00Z")],
			nextRunAt: timestampMs("2026-01-01T03:30:00Z"),
		});
		expect(
			getDueOccurrences(
				{ spec: { ...hourlyInterval, overlapPolicy: "allow" }, createdAt },
				timestampMs("2026-01-01T03:15:00Z")
			)
		).toEqual({
			occurrences: [timestampMs("2026-01-01T01:30:00Z"), timestampMs("2026-01-01T02:30:00Z")],
			nextRunAt: timestampMs("2026-01-01T03:30:00Z"),
		});
	});
});
