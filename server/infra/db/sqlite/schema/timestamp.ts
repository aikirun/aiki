import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/sqlite-core";

export const sqliteTimestamp = customType<{ data: Date; driverData: string }>({
	dataType() {
		return "text";
	},
	fromDriver(value: string): Date {
		if (value === null || value === undefined) return null as unknown as Date;
		return new Date(value);
	},
	toDriver(value: Date): string {
		return value.toISOString();
	},
});

export const sqliteTimestampMs = customType<{ data: number; driverData: number }>({
	dataType() {
		return "integer";
	},
	fromDriver(value: number): number {
		if (value === null || value === undefined) return null as unknown as number;
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

export const SQLITE_CURRENT_TIMESTAMP = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
export const SQLITE_CURRENT_TIMESTAMP_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
