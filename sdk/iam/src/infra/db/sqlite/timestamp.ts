import type { TimestampMs } from "@aikirun/lib/timestamp";
import { customType } from "drizzle-orm/sqlite-core";

export const timestampMs = customType<{ data: TimestampMs; driverData: number }>({
	dataType() {
		return "integer";
	},
	toDriver(value: TimestampMs | Date): number {
		return value instanceof Date ? value.getTime() : value;
	},
});
