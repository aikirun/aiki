import type { DatabaseConfig } from "@aikirun/lib/db";
import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./pg/provider";
import type { SqliteClient } from "./sqlite/client";

export function database(config: DatabaseConfig): CreateDatabase {
	let createDbPromise: Promise<Database> | undefined;

	const createDbFn = () => {
		createDbPromise ??= (async () => {
			switch (config.provider) {
				case "pg": {
					const postgres = await importPostgres();
					// Keys must be absent, not undefined: the driver merges options by key presence,
					// so an explicit undefined beats its own default.
					const client = postgres(config.url, {
						...(config.maxConnections !== undefined && { max: config.maxConnections }),
						...(config.caCert !== undefined && { ssl: { ca: config.caCert, rejectUnauthorized: true } }),
					});
					return { provider: "pg", [INTERNAL]: { client } };
				}
				case "sqlite": {
					const { createSqliteClient } = await import("./sqlite/client");
					return { provider: "sqlite", [INTERNAL]: { client: createSqliteClient(config) } };
				}
				// case "mysql":
				// 	throw new Error("MySQL support not yet implemented");
				default:
					return config satisfies never;
			}
		})();
		return createDbPromise;
	};

	return Object.assign(createDbFn, {
		close: async (): Promise<void> => {
			if (!createDbPromise) {
				return;
			}
			const db = await createDbPromise;
			switch (db.provider) {
				case "pg": {
					const client = db[INTERNAL].client as PgClient;
					await client.end();
					return;
				}
				case "sqlite": {
					const client = db[INTERNAL].client as SqliteClient;
					client.close();
					return;
				}
				// case "mysql":
				// 	throw new Error("MySQL support not yet implemented");
				default:
					db.provider satisfies never;
			}
		},
	});
}

async function importPostgres() {
	try {
		const { default: postgres } = await import("postgres");
		return postgres;
	} catch {
		throw new Error("the pg provider requires the postgres driver, install it with: npm install postgres");
	}
}
