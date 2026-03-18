/**
 * Timestamp helpers for SQLite
 *
 * SQLite stores timestamps as TEXT (ISO8601 strings).
 * This provides a custom type that handles conversion to/from JavaScript numbers (epoch ms).
 */

import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/sqlite-core";

/**
 * Timestamp stored as TEXT in ISO8601 format, converted to/from epoch milliseconds.
 * Mirrors the PostgreSQL timestampMs custom type behavior.
 */
export const timestampMs = customType<{ data: number; driverValue: string }>({
	dataType() {
		return "TEXT";
	},
	fromDriver(value: unknown): number {
		return new Date(value as string).getTime();
	},
	toDriver(value: number | Date): string {
		if (value instanceof Date) return value.toISOString();
		return new Date(value).toISOString();
	},
});

/**
 * Default SQL expression for current timestamp in SQLite.
 * Returns ISO8601 formatted string.
 */
export const currentTimestamp = sql`(datetime('now'))`;

/**
 * Default SQL expression for current timestamp with milliseconds.
 * SQLite's datetime() only goes to seconds, use strftime for ms.
 */
export const currentTimestampMs = sql`(strftime('%Y-%m-%dT%H:%M:%f', 'now') || 'Z')`;
