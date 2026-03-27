import { drizzle } from "drizzle-orm/bun-sqlite";

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Repositories } from "../../types";
import { createSqliteRepositories } from "..";
import type { createSqliteDatabase } from "../provider";
import * as schema from "../schema";

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS "organization" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "logo" TEXT,
    "metadata" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)),
    "updated_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer))
  );

  CREATE TABLE IF NOT EXISTS "namespace" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id"),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)),
    "updated_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer))
  );

  CREATE TABLE IF NOT EXISTS "test_kv" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
  );
`;

let raw: Database;
let conn: ReturnType<typeof createSqliteDatabase>["conn"];
let repos: Repositories;

beforeEach(() => {
	raw = new Database(":memory:");
	raw.exec("PRAGMA journal_mode = WAL");
	raw.exec("PRAGMA foreign_keys = ON");
	conn = drizzle(raw, { schema });
	raw.exec(CREATE_TABLES);
	repos = createSqliteRepositories(conn, raw);
});

afterEach(() => {
	raw.close();
});

function queryAll(statement: string) {
	return raw.query(statement).all();
}

describe("transaction serializer", () => {
	it("commits inserts made inside a transaction", async () => {
		await repos.transaction(async () => {
			raw.exec(`INSERT INTO test_kv (key, value) VALUES ('a', '1')`);
		});

		const rows = queryAll("SELECT * FROM test_kv");
		expect(rows).toHaveLength(1);
		expect((rows[0] as { key: string; value: string }).value).toBe("1");
	});

	it("rolls back on error", async () => {
		await expect(
			repos.transaction(async () => {
				raw.exec(`INSERT INTO test_kv (key, value) VALUES ('a', '1')`);
				throw new Error("boom");
			})
		).rejects.toThrow("boom");

		const rows = queryAll("SELECT * FROM test_kv");
		expect(rows).toHaveLength(0);
	});

	it("serializes concurrent transactions without sqlite errors", async () => {
		const results = await Promise.all(
			[1, 2, 3].map((i) =>
				repos.transaction(async () => {
					raw.exec(`INSERT INTO test_kv (key, value) VALUES ('k${i}', '${i}')`);
					return i;
				})
			)
		);

		expect(results.sort()).toEqual([1, 2, 3]);
		const rows = queryAll("SELECT * FROM test_kv ORDER BY key");
		expect(rows).toHaveLength(3);
	});

	it("serializes non-transactional writes behind an active transaction", async () => {
		const order: string[] = [];

		raw.exec(`INSERT INTO organization (id, name, slug, type) VALUES ('org1', 'Org', 'org1', 'personal')`);

		const txPromise = repos.transaction(async () => {
			await Bun.sleep(50);
			raw.exec(`INSERT INTO test_kv (key, value) VALUES ('tx', '1')`);
			order.push("tx");
		});

		const writePromise = repos.namespace
			.create({
				id: "ns1",
				name: "test",
				organizationId: "org1",
			})
			.then(() => {
				order.push("write");
			});

		await Promise.all([txPromise, writePromise]);

		expect(order).toEqual(["tx", "write"]);
	});

	it("allows multiple sequential repo calls inside one transaction (re-entrancy)", async () => {
		raw.exec(`INSERT INTO organization (id, name, slug, type) VALUES ('org1', 'Org', 'org1', 'personal')`);

		await repos.transaction(async (txRepos) => {
			const ns1 = await txRepos.namespace.create({
				id: "ns1",
				name: "first",
				organizationId: "org1",
			});
			expect(ns1.id).toBe("ns1");

			const ns2 = await txRepos.namespace.create({
				id: "ns2",
				name: "second",
				organizationId: "org1",
			});
			expect(ns2.id).toBe("ns2");
		});

		const rows = queryAll("SELECT * FROM namespace ORDER BY id");
		expect(rows).toHaveLength(2);
	});

	it("propagates errors from serialize and advances the queue", async () => {
		const err = new Error("first fails");

		await expect(
			repos.transaction(async () => {
				throw err;
			})
		).rejects.toThrow("first fails");

		await repos.transaction(async () => {
			raw.exec(`INSERT INTO test_kv (key, value) VALUES ('after', 'ok')`);
		});

		const rows = queryAll("SELECT * FROM test_kv WHERE key = 'after'");
		expect(rows).toHaveLength(1);
	});

	it("allows new transactions after a rollback", async () => {
		await expect(
			repos.transaction(async () => {
				raw.exec(`INSERT INTO test_kv (key, value) VALUES ('a', '1')`);
				throw new Error("fail");
			})
		).rejects.toThrow("fail");

		expect(queryAll("SELECT * FROM test_kv")).toHaveLength(0);

		await repos.transaction(async () => {
			raw.exec(`INSERT INTO test_kv (key, value) VALUES ('b', '2')`);
		});

		const rows = queryAll("SELECT * FROM test_kv");
		expect(rows).toHaveLength(1);
		expect((rows[0] as { key: string; value: string }).key).toBe("b");
	});
});
