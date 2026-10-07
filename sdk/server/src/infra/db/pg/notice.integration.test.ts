import { loadDatabaseConfig, loadDatabaseProvider } from "@aikirun/lib/db";
import { type Logger, noopLogger } from "@aikirun/lib/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import { expect, test } from "vitest";

import type { PgClient } from "./provider";
import { database } from "..";

test.skipIf(loadDatabaseProvider() !== "pg")("logs a Postgres notice at debug level", async () => {
	const loggedMessages: string[] = [];
	const logger: Logger = {
		...noopLogger,
		debug: (message) => {
			loggedMessages.push(message);
		},
	};
	const createDbConn = database(loadDatabaseConfig(), { logger });
	try {
		const db = await createDbConn();
		const client = db[INTERNAL].client as PgClient;

		await client.unsafe("DO $$ BEGIN RAISE NOTICE 'restocking widgets'; END $$");

		expect(loggedMessages).toEqual(["Postgres notice: restocking widgets"]);
	} finally {
		await createDbConn.close();
	}
});

test.skipIf(loadDatabaseProvider() !== "pg")("logs a Postgres warning at warn level", async () => {
	const loggedMessages: string[] = [];
	const logger: Logger = {
		...noopLogger,
		warn: (message) => {
			loggedMessages.push(message);
		},
	};
	const createDbConn = database(loadDatabaseConfig(), { logger });
	try {
		const db = await createDbConn();
		const client = db[INTERNAL].client as PgClient;

		await client.unsafe("DO $$ BEGIN RAISE WARNING 'widgets are running low'; END $$");

		expect(loggedMessages).toEqual(["Postgres warning: widgets are running low"]);
	} finally {
		await createDbConn.close();
	}
});
