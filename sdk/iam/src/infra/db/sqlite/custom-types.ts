import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/sqlite-core";

// iam stores timestamps as epoch milliseconds (matching the pg `timestampMs` type).
export const sqliteTimestampMs = customType<{ data: number; driverData: number }>({
	dataType() {
		return "integer";
	},
	fromDriver(value: number): number {
		return value;
	},
	toDriver(value: number | Date): number {
		if (value instanceof Date) return value.getTime();
		return value;
	},
});

export const sqliteJson = customType<{ data: unknown; driverData: string }>({
	dataType() {
		return "text";
	},
	fromDriver(value: string): unknown {
		if (value === null || value === undefined) return null;
		return typeof value === "string" ? JSON.parse(value) : value;
	},
	toDriver(value: unknown): string {
		if (value === null || value === undefined) return null as unknown as string;
		return JSON.stringify(value);
	},
});

export const SQLITE_CURRENT_TIMESTAMP_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
