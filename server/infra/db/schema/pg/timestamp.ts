import { customType } from "drizzle-orm/pg-core";

export const timestampMs = customType<{ data: number; driverData: string }>({
	dataType() {
		return "timestamp with time zone";
	},
	fromDriver(value: string): number {
		return new Date(value).getTime();
	},
	toDriver(value: number | Date): string {
		if (value instanceof Date) return value.toISOString();
		return new Date(value).toISOString();
	},
});
