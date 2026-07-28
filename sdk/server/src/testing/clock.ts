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
