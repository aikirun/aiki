import type { Duration, DurationFields } from "./types.ts";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

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

	if (duration.ms !== undefined) {
		assertIsPositiveNumber(duration.ms, "ms");
		totalMs += duration.ms;
	}

	return totalMs;
}

function assertIsPositiveNumber(value: number, field?: keyof DurationFields): void {
	if (!isFinite(value)) {
		throw new Error(
			field !== undefined
				? `'${field}' duration must be finite. Received: ${value}`
				: `Duration must be finite. Received: ${value}`,
		);
	}

	if (value < 0) {
		throw new Error(
			field !== undefined
				? `'${field}' duration must be non-negative. Received: ${value}`
				: `Duration must be non-negative. Received: ${value}`,
		);
	}
}
