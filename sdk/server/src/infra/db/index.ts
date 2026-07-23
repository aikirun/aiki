import type { DatabaseConfig } from "@aikirun/lib/db";
import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

export function database(config: DatabaseConfig): CreateDatabase {
	let createDatabasePromise: Promise<Database> | undefined;
	return () => {
		if (!createDatabasePromise) {
			createDatabasePromise = createDatabase(config);
		}
		return createDatabasePromise;
	};
}

async function createDatabase(config: DatabaseConfig): Promise<Database> {
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
}

async function importPostgres() {
	try {
		const { default: postgres } = await import("postgres");
		return postgres;
	} catch {
		throw new Error("the pg provider requires the postgres driver, install it with: npm install postgres");
	}
}
