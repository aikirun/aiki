export type TimestampMs = number & { _brand: "timestamp_ms" };

/** The last millisecond of the year 9999, the latest instant every database provider stores. */
export const MAX_TIMESTAMP_MS = 253_402_300_799_999 as TimestampMs;
