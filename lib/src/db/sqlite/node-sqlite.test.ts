import { describe, expect, test } from "vitest";

import type { SqliteClient, SqliteParam } from "./client";
import { openSqliteClient } from "./open";

async function withSqliteClient(fn: (client: SqliteClient) => Promise<void>): Promise<void> {
	const client = await openSqliteClient({ provider: "sqlite", path: ":memory:" });
	try {
		await fn(client);
	} finally {
		client.close();
	}
}

describe("openSqliteClient", () => {
	test("opens with synchronous set to FULL", () =>
		withSqliteClient(async (client) => {
			const synchronousFull = 2;
			expect((await client.execute("PRAGMA synchronous")).rows).toEqual([[synchronousFull]]);
		}));
});

describe("execute", () => {
	test("returns each row as an array in column order, keeping columns that share a name", () =>
		withSqliteClient(async (client) => {
			const result = await client.execute("SELECT 'north' AS depot, 'south' AS depot");
			expect(result).toEqual({ columns: ["depot", "depot"], rows: [["north", "south"]], rowsAffected: 0 });
		}));

	test("reports how many rows a statement that returns none changed", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY, depot text NOT NULL)");
			await client.execute(
				"INSERT INTO parcel (id, depot) VALUES ('parcel-1', 'north'), ('parcel-2', 'north'), ('parcel-3', 'south')"
			);

			const result = await client.execute("UPDATE parcel SET depot = ? WHERE depot = ?", ["east", "north"]);
			expect(result).toEqual({ columns: [], rows: [], rowsAffected: 2 });
		}));

	test("sends true as 1 and false as 0", () =>
		withSqliteClient(async (client) => {
			const result = await client.execute("SELECT ? AS fragile, ? AS insured", [true, false]);
			expect(result.rows).toEqual([[1, 0]]);
		}));

	test("refuses a value SQLite cannot store", () =>
		withSqliteClient(async (client) => {
			const collectedOn = new Date(0) as unknown as SqliteParam;
			await expect(client.execute("SELECT ? AS parcel, ? AS collected_on", ["parcel-1", collectedOn])).rejects.toThrow(
				"SQL parameter 2 is [object Date], which SQLite cannot store"
			);
		}));

	test("refuses SQL that holds more than one statement, and runs none of it", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");

			await expect(
				client.execute("INSERT INTO parcel (id) VALUES ('parcel-1'); INSERT INTO parcel (id) VALUES ('parcel-2')")
			).rejects.toThrow("execute takes one SQL statement, and this text holds more");

			expect((await client.execute("SELECT id FROM parcel")).rows).toEqual([]);
		}));
});

describe("transaction", () => {
	test("keeps its writes once it commits", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			const transaction = await client.transaction();
			await transaction.execute("INSERT INTO parcel (id) VALUES ('parcel-1')");

			await transaction.commit();

			expect((await client.execute("SELECT id FROM parcel")).rows).toEqual([["parcel-1"]]);
		}));

	test("undoes its writes when it rolls back", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			const transaction = await client.transaction();
			await transaction.execute("INSERT INTO parcel (id) VALUES ('parcel-1')");

			await transaction.rollback();

			expect((await client.execute("SELECT id FROM parcel")).rows).toEqual([]);
		}));

	test("runs every statement of a script", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			const transaction = await client.transaction();

			await transaction.executeScript(
				"INSERT INTO parcel (id) VALUES ('parcel-1'); INSERT INTO parcel (id) VALUES ('parcel-2');"
			);
			await transaction.commit();

			expect((await client.execute("SELECT id FROM parcel ORDER BY id")).rows).toEqual([["parcel-1"], ["parcel-2"]]);
		}));

	test("refuses a statement once it has ended", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			const transaction = await client.transaction();
			await transaction.commit();

			await expect(transaction.execute("INSERT INTO parcel (id) VALUES ('parcel-1')")).rejects.toThrow(
				"the transaction has ended"
			);

			expect((await client.execute("SELECT id FROM parcel")).rows).toEqual([]);
		}));

	test("ends when its commit fails, undoing its writes", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE depot (id text PRIMARY KEY)");
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY, depot_id text NOT NULL REFERENCES depot (id))");
			const absentDepotId = crypto.randomUUID();
			const transaction = await client.transaction();
			// The missing depot is checked at commit, so the insert goes through and the commit fails.
			await transaction.execute("PRAGMA defer_foreign_keys = ON");
			await transaction.execute("INSERT INTO parcel (id, depot_id) VALUES ('parcel-1', ?)", [absentDepotId]);
			expect((await transaction.execute("SELECT id FROM parcel")).rows).toEqual([["parcel-1"]]);

			await expect(transaction.commit()).rejects.toThrow("FOREIGN KEY constraint failed");

			// A transaction still open on the connection would refuse the next one.
			const nextTransaction = await client.transaction();
			await nextTransaction.rollback();
			expect((await client.execute("SELECT id FROM parcel")).rows).toEqual([]);
		}));

	test("does nothing when rolled back after it has ended", () =>
		withSqliteClient(async (client) => {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			const transaction = await client.transaction();
			await transaction.commit();
			// A rollback that reached the connection would undo the transaction now open on it.
			const nextTransaction = await client.transaction();
			await nextTransaction.execute("INSERT INTO parcel (id) VALUES ('parcel-1')");

			await transaction.rollback();

			await nextTransaction.commit();
			expect((await client.execute("SELECT id FROM parcel")).rows).toEqual([["parcel-1"]]);
		}));
});

describe("close", () => {
	test("does nothing the second time", async () => {
		const client = await openSqliteClient({ provider: "sqlite", path: ":memory:" });
		client.close();

		expect(() => client.close()).not.toThrow();
	});
});
