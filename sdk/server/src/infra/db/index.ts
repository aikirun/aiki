import type { DatabaseConfig } from "@aikirun/lib/db";
import type { SqliteClient } from "@aikirun/lib/db/sqlite";
import { consoleLogger, type Logger } from "@aikirun/lib/logger";
import type { CreateDatabase, Database, DatabaseCloseOptions } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./pg/provider";

const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

export interface DatabaseOptions {
	logger?: Logger;
}

export function database(config: DatabaseConfig, options?: DatabaseOptions): CreateDatabase {
	let createDbPromise: Promise<Database> | undefined;

	const createDbFn = () => {
		createDbPromise ??= (async () => {
			switch (config.provider) {
				case "sqlite": {
					const { createSqliteClient } = await import("./sqlite/client");
					return { provider: "sqlite", [INTERNAL]: { client: createSqliteClient(config) } };
				}
				case "pg": {
					const postgres = await importPostgres();
					const logger = options?.logger ?? consoleLogger();
					// Keys must be absent, not undefined: the driver merges options by key presence,
					// so an explicit undefined beats its own default.
					const client = postgres(config.url, {
						...(config.maxConnections !== undefined && { max: config.maxConnections }),
						...(config.caCert !== undefined && { ssl: { ca: config.caCert, rejectUnauthorized: true } }),
						onnotice: (notice) => {
							if (notice.severity === "WARNING") {
								logger.warn(`Postgres warning: ${notice.message}`);
								return;
							}
							logger.debug(`Postgres notice: ${notice.message}`);
						},
					});
					return { provider: "pg", [INTERNAL]: { client } };
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
		close: async (options?: DatabaseCloseOptions): Promise<void> => {
			if (!createDbPromise) {
				return;
			}
			const db = await createDbPromise;
			switch (db.provider) {
				case "sqlite": {
					const client = db[INTERNAL].client as SqliteClient;
					client.close();
					return;
				}
				case "pg": {
					const client = db[INTERNAL].client as PgClient;
					const timeoutMs = options?.timeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
					await client.end({ timeout: timeoutMs / 1_000 });
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
