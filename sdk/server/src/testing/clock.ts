import type { TimestampMs } from "@aikirun/lib/timestamp";
import { vi } from "vitest";

// The frozen times of the withFakeClock calls still running, innermost last.
const frozenTimestamps: number[] = [];

// Runs fn with the JS clock frozen at seedTimestampMs. Afterwards, even on throw, the clock goes back to
// the time an enclosing withFakeClock froze, or to the real clock when there is none.
// Only use in integration tests because they are run sequentially.
export async function withFakeClock<T>(seedTimestampMs: number, fn: () => Promise<T>): Promise<T> {
	const clock = await systemClock();
	frozenTimestamps.push(seedTimestampMs);
	clock.freeze(seedTimestampMs);
	try {
		return await fn();
	} finally {
		frozenTimestamps.pop();
		const enclosingTimestampMs = frozenTimestamps.at(-1);
		if (enclosingTimestampMs === undefined) {
			clock.restore();
		} else {
			clock.freeze(enclosingTimestampMs);
		}
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
