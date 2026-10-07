import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { createSqliteClient } from "./client";

describe("createSqliteClient", () => {
	test("runs a statement issued during a transaction after the transaction has ended", async () => {
		const client = createSqliteClient({ provider: "sqlite", path: ":memory:" });
		try {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			const transaction = await client.transaction();
			await transaction.execute("INSERT INTO parcel (id) VALUES ('parcel-1')");

			// Issued while the transaction is open: run then, it would read parcel-1.
			const parcelsReading = client.execute("SELECT id FROM parcel");
			await transaction.rollback();

			expect((await parcelsReading).rows).toEqual([]);
		} finally {
			client.close();
		}
	});

	test("opens a transaction only once the one before it has ended", async () => {
		const client = createSqliteClient({ provider: "sqlite", path: ":memory:" });
		try {
			await client.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			const firstTransaction = await client.transaction();

			const secondTransactionOpening = client.transaction();
			await firstTransaction.execute("INSERT INTO parcel (id) VALUES ('parcel-1')");
			await firstTransaction.commit();
			const secondTransaction = await secondTransactionOpening;

			expect((await secondTransaction.execute("SELECT id FROM parcel")).rows).toEqual([["parcel-1"]]);
			await secondTransaction.rollback();
		} finally {
			client.close();
		}
	});

	test("makes two clients opened on one file take turns", async () => {
		const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-client-"));
		const databasePath = path.join(databaseDir, "parcels.db");
		const firstClient = createSqliteClient({ provider: "sqlite", path: databasePath });
		const secondClient = createSqliteClient({ provider: "sqlite", path: databasePath });
		try {
			await firstClient.execute("CREATE TABLE parcel (id text PRIMARY KEY)");
			// A client opens its file on first use, so this puts the second connection in place.
			await secondClient.execute("SELECT id FROM parcel");
			const transaction = await firstClient.transaction();
			await transaction.execute("INSERT INTO parcel (id) VALUES ('parcel-1')");

			// The transaction holds the file's write lock, so this write can only go through after it.
			const secondClientWriting = secondClient.execute("INSERT INTO parcel (id) VALUES ('parcel-2')");
			await transaction.commit();
			await secondClientWriting;

			expect((await firstClient.execute("SELECT id FROM parcel ORDER BY id")).rows).toEqual([
				["parcel-1"],
				["parcel-2"],
			]);
		} finally {
			// The directory is left for the system to clear: Bun keeps a SQLite file open after
			// close() until it collects garbage, and Windows will not delete an open file.
			firstClient.close();
			secondClient.close();
		}
	});
});
