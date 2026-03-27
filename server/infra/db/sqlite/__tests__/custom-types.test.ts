import { eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	SQLITE_CURRENT_TIMESTAMP,
	SQLITE_CURRENT_TIMESTAMP_MS,
	sqliteJson,
	sqliteTimestamp,
	sqliteTimestampMs,
} from "../schema/timestamp";

const testTable = sqliteTable("test_custom_types", {
	id: text("id").primaryKey(),
	ts: sqliteTimestamp("ts"),
	tsRequired: sqliteTimestamp("ts_required").notNull().default(SQLITE_CURRENT_TIMESTAMP),
	tsMs: sqliteTimestampMs("ts_ms"),
	tsMsRequired: sqliteTimestampMs("ts_ms_required").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
	jsonData: sqliteJson("json_data"),
});

function first<T>(rows: T[]): T {
	if (rows.length === 0) throw new Error("expected at least one row");
	return rows[0] as T;
}

describe("custom drizzle types", () => {
	let sqlite: Database;
	let db: ReturnType<typeof drizzle>;

	beforeAll(() => {
		sqlite = new Database(":memory:");
		db = drizzle(sqlite);
		sqlite.run(`
			CREATE TABLE "test_custom_types" (
				"id" TEXT PRIMARY KEY,
				"ts" TEXT,
				"ts_required" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				"ts_ms" INTEGER,
				"ts_ms_required" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)),
				"json_data" TEXT
			)
		`);
	});

	afterAll(() => {
		sqlite.close();
	});

	it("sqliteTimestamp roundtrip", async () => {
		const now = new Date();
		await db.insert(testTable).values({ id: "ts-1", ts: now });
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "ts-1")));
		expect(row.ts).toBeInstanceOf(Date);
		expect(row.ts?.getTime()).toBe(now.getTime());
	});

	it("sqliteTimestamp null", async () => {
		await db.insert(testTable).values({ id: "ts-null" });
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "ts-null")));
		expect(row.ts).toBeNull();
	});

	it("sqliteTimestamp default", async () => {
		const before = Date.now();
		await db.insert(testTable).values({ id: "ts-default" });
		const after = Date.now();
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "ts-default")));
		expect(row.tsRequired).toBeInstanceOf(Date);
		expect(row.tsRequired.getTime()).toBeGreaterThanOrEqual(before - 1000);
		expect(row.tsRequired.getTime()).toBeLessThanOrEqual(after + 1000);
	});

	it("sqliteTimestampMs roundtrip", async () => {
		const now = Date.now();
		await db.insert(testTable).values({ id: "ms-1", tsMs: now });
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "ms-1")));
		expect(typeof row.tsMs).toBe("number");
		expect(Math.abs((row.tsMs as number) - now)).toBeLessThanOrEqual(1);
	});

	it("sqliteTimestampMs default", async () => {
		const before = Date.now();
		await db.insert(testTable).values({ id: "ms-default" });
		const after = Date.now();
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "ms-default")));
		expect(typeof row.tsMsRequired).toBe("number");
		expect(row.tsMsRequired).toBeGreaterThanOrEqual(before - 1000);
		expect(row.tsMsRequired).toBeLessThanOrEqual(after + 1000);
	});

	it("sqliteTimestampMs from Date", async () => {
		const date = new Date();
		await db.insert(testTable).values({ id: "ms-date", tsMs: date as unknown as number });
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "ms-date")));
		expect(row.tsMs).toBe(date.getTime());
	});

	it("sqliteJson roundtrip", async () => {
		const data = { key: "value", nested: { a: 1 } };
		await db.insert(testTable).values({ id: "json-1", jsonData: data });
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "json-1")));
		expect(row.jsonData).toEqual(data);
	});

	it("sqliteJson null", async () => {
		await db.insert(testTable).values({ id: "json-null" });
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "json-null")));
		expect(row.jsonData).toBeNull();
	});

	it("sqliteJson with array", async () => {
		const data = [1, 2, 3];
		await db.insert(testTable).values({ id: "json-arr", jsonData: data });
		const row = first(await db.select().from(testTable).where(eq(testTable.id, "json-arr")));
		expect(row.jsonData).toEqual(data);
	});

	it("timestamp comparison with lte", async () => {
		const t1 = new Date("2024-01-01T00:00:00.000Z");
		const t2 = new Date("2024-06-01T00:00:00.000Z");
		const t3 = new Date("2025-01-01T00:00:00.000Z");

		await db.insert(testTable).values([
			{ id: "cmp-1", ts: t1 },
			{ id: "cmp-2", ts: t2 },
			{ id: "cmp-3", ts: t3 },
		]);

		const cutoff = new Date("2024-06-01T00:00:00.000Z");
		const rows = await db.select().from(testTable).where(lte(testTable.ts, cutoff)).orderBy(testTable.ts);

		const ids = rows.map((r) => r.id);
		expect(ids).toEqual(["cmp-1", "cmp-2"]);
	});
});
