import type { Duration, DurationFields } from "./types.ts";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Converts a Duration to milliseconds.
 *
 * Accepts either raw milliseconds (number) or a DurationObject with time units.
 * All values must be non-negative and finite. The maximum duration is 1 year (31,536,000,000ms).
 *
 * @param duration - Duration as milliseconds or object with time units (days, hours, minutes, seconds, milliseconds)
 * @returns Duration in milliseconds
 * @throws {Error} If duration is invalid (negative, non-finite, zero value, or exceeds 1 year)
 *
 * @example
 * // Using milliseconds
 * toMilliseconds(5000) // => 5000
 *
 * @example
 * // Using duration object
 * toMilliseconds({ seconds: 5 }) // => 5000
 * toMilliseconds({ minutes: 1, seconds: 30 }) // => 90000
 * toMilliseconds({ days: 1, hours: 2 }) // => 93600000
 *
 * @example
 * // Using in workflows
 * await run.sleep({ hours: 2, minutes: 30 })
 */
export function toMilliseconds(duration: Duration): number {
	if (typeof duration === "number") {
		assertIsPositiveNumber(duration);
		return duration;
	}

	let totalMs = 0;

	if (duration.days !== undefined) {
		assertIsPositiveNumber(duration.days, "days");
		totalMs += duration.days * MS_PER_DAY;
	}

	if (duration.hours !== undefined) {
		assertIsPositiveNumber(duration.hours, "hours");
		totalMs += duration.hours * MS_PER_HOUR;
	}

	if (duration.minutes !== undefined) {
		assertIsPositiveNumber(duration.minutes, "minutes");
		totalMs += duration.minutes * MS_PER_MINUTE;
	}

	if (duration.seconds !== undefined) {
		assertIsPositiveNumber(duration.seconds, "seconds");
		totalMs += duration.seconds * MS_PER_SECOND;
	}

	if (duration.milliseconds !== undefined) {
		assertIsPositiveNumber(duration.milliseconds, "milliseconds");
		totalMs += duration.milliseconds;
	}

	return totalMs;
}

function assertIsPositiveNumber(value: number, field?: keyof DurationFields): void {
	if (!Number.isFinite(value)) {
		throw new Error(
			field !== undefined
				? `'${field}' duration must be finite. Received: ${value}`
				: `Duration must be finite. Received: ${value}`
		);
	}

	if (value < 0) {
		throw new Error(
			field !== undefined
				? `'${field}' duration must be non-negative. Received: ${value}`
				: `Duration must be non-negative. Received: ${value}`
		);
	}
}
