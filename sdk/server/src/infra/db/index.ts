import type { DatabaseConfig } from "@aikirun/lib/db";
import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./pg/provider";

export function database(config: DatabaseConfig): CreateDatabase {
	let createDbPromise: Promise<Database> | undefined;

	const createDbFn = () => {
		if (createDbPromise) {
			return createDbPromise;
		}
		createDbPromise = (async () => {
			switch (config.provider) {
				case "pg": {
					const postgres = await importPostgres();
					const client = postgres(config.url, {
						max: config.maxConnections,
						ssl: config.caCert ? { ca: config.caCert, rejectUnauthorized: true } : undefined,
					});
					return { provider: "pg", [INTERNAL]: { client } };
				}
				// case "sqlite":
				// 	throw new Error("SQLite support not yet implemented");
				// case "mysql":
				// 	throw new Error("MySQL support not yet implemented");
				default:
					return config.provider satisfies never;
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
				// case "sqlite":
				// 	throw new Error("SQLite support not yet implemented");
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
