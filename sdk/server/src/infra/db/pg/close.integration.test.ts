import { loadDatabaseProvider } from "@aikirun/lib/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { expect, test } from "vitest";

import type { PgClient } from "./provider";
import { database } from "..";

test.skipIf(loadDatabaseProvider() !== "pg")(
	"close resolves while a query is still connecting to a database that cannot be reached",
	async () => {
		// Nothing listens on port 1, so the connection is refused.
		const createDbConn = database({ provider: "pg", url: "postgresql://user:password@127.0.0.1:1/orders" });
		const db = await createDbConn();
		const client = db[INTERNAL].client as PgClient;

		// The driver starts a query when its promise is first chained. Close is called in the same
		// turn, before the refusal can arrive, so the query is still connecting when close begins.
		client`select 1`.catch(() => {});

		await expect(createDbConn.close({ timeoutMs: 0 })).resolves.toBeUndefined();
	}
);
