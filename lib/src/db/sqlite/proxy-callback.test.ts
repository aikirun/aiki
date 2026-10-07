import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, test } from "vitest";

import type { SqliteClient } from "./client";
import { openSqliteClient } from "./open";
import { drizzleSqliteProxyCallback } from "./proxy-callback";

async function withSqliteClient(fn: (client: SqliteClient) => Promise<void>): Promise<void> {
	const client = await openSqliteClient({ provider: "sqlite", path: ":memory:" });
	try {
		await fn(client);
	} finally {
		client.close();
	}
}

describe("drizzleSqliteProxyCallback", () => {
	const parcel = sqliteTable("parcel", { id: text("id").primaryKey(), depot: text("depot").notNull() });

	test("answers a single-row read with the row", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY, depot text NOT NULL)");
			await client.execute("INSERT INTO parcel (id, depot) VALUES ('parcel-1', 'north')");
			const db = drizzle(drizzleSqliteProxyCallback(client));

			expect(await db.select().from(parcel).where(eq(parcel.id, "parcel-1")).get()).toEqual({
				id: "parcel-1",
				depot: "north",
			});
		}));

	test("answers a single-row read that finds nothing with undefined", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY, depot text NOT NULL)");
			const db = drizzle(drizzleSqliteProxyCallback(client));

			expect(await db.select().from(parcel).where(eq(parcel.id, "parcel-1")).get()).toBeUndefined();
		}));

	test("answers a write that returns no rows with the count it changed", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY, depot text NOT NULL)");
			await client.execute("INSERT INTO parcel (id, depot) VALUES ('parcel-1', 'north'), ('parcel-2', 'north')");
			const db = drizzle(drizzleSqliteProxyCallback(client));

			expect(await db.update(parcel).set({ depot: "east" }).where(eq(parcel.depot, "north"))).toEqual({
				rows: [],
				rowsAffected: 2,
			});
		}));
});
