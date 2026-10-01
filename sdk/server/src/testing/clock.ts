import type { TimestampMs } from "@aikirun/lib/timestamp";
import { vi } from "vitest";

// Runs fn with the JS clock frozen at seedTimestampMs, restoring the real clock afterwards even on throw.
// Only use in integration tests because they are run sequentially.
export async function withFakeClock<T>(seedTimestampMs: number, fn: () => Promise<T>): Promise<T> {
	const clock = await systemClock();
	clock.freeze(seedTimestampMs);
	try {
		return await fn();
	} finally {
		clock.restore();
	}
}

/** A due-time cutoff every stored instant falls before: 9999-12-31, the last day of the calendar. */
export const END_OF_TIME = 253_402_214_400_000 as TimestampMs;

// Vitest freezes the clock through `vi`. Bun's `vi` has no setSystemTime; Bun exports its own from bun:test.
async function systemClock(): Promise<{ freeze: (timestampMs: number) => void; restore: () => void }> {
	if ("Bun" in globalThis) {
		const { setSystemTime } = await import("bun:test");
		return {
			freeze: (timestampMs) => {
				setSystemTime(new Date(timestampMs));
			},
			restore: () => {
				setSystemTime();
			},
		};
	}

	return {
		freeze: (timestampMs) => {
			vi.setSystemTime(timestampMs);
		},
		restore: () => {
			vi.useRealTimers();
		},
	};
}
