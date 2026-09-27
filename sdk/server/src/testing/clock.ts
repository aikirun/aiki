import type { TimestampMs } from "@aikirun/lib/timestamp";

import { setSystemTime } from "bun:test";

// Runs fn with the JS clock frozen at seedTimestampMs, restoring the real clock afterwards even on throw.
// Only use in integration tests because they are run sequentially.
export async function withFakeClock<T>(seedTimestampMs: number, fn: () => Promise<T>): Promise<T> {
	setSystemTime(new Date(seedTimestampMs));
	try {
		return await fn();
	} finally {
		setSystemTime();
	}
}

/** A due-time cutoff every stored instant falls before: 9999-12-31, the last day of the calendar. */
export const END_OF_TIME = 253_402_214_400_000 as TimestampMs;
