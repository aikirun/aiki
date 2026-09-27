import type { TimestampMs } from "@aikirun/lib/timestamp";
import { customType } from "drizzle-orm/pg-core";

export const timestampMs = customType<{ data: TimestampMs; driverData: string }>({
	dataType() {
		return "timestamp with time zone";
	},
	fromDriver(value: string): TimestampMs {
		return new Date(value).getTime() as TimestampMs;
	},
	toDriver(value: TimestampMs | Date): string {
		if (value instanceof Date) return value.toISOString();
		return new Date(value).toISOString();
	},
});
