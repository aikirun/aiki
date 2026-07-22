import { encodeTime } from "ulidx";

// A ULID is a 10-character timestamp followed by a 16-character random component.
const ULID_RANDOM_PORTION_LEN = 16;
const ULID_MAX_CHAR = "Z";

/**
 * Returns the lexicographically largest possible ULID whose encoded timestamp is `timestampMs`.
 */
export function ulidUpperBound(seedTimestampMs: number): string {
	return encodeTime(seedTimestampMs, 10) + ULID_MAX_CHAR.repeat(ULID_RANDOM_PORTION_LEN);
}
