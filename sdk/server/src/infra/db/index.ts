import type { DatabaseConfig, PgDatabaseConfig } from "@aikirun/lib/db";
import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

export function database(config: DatabaseConfig): CreateDatabase {
	if (config.provider !== "pg") {
		throw new Error(`${config.provider} support not yet implemented`);
	}

	let createDatabasePromise: Promise<Database> | undefined;
	return () => {
		if (!createDatabasePromise) {
			createDatabasePromise = createDatabase(config);
		}
		return createDatabasePromise;
	};
}

async function createDatabase(config: PgDatabaseConfig): Promise<Database> {
	const postgres = await importPostgres();
	const client = postgres(config.url, {
		max: config.maxConnections,
		ssl: config.ssl,
	});
	return { provider: "pg", [INTERNAL]: { client } };
}

async function importPostgres() {
	try {
		const { default: postgres } = await import("postgres");
		return postgres;
	} catch {
		throw new Error("the pg provider requires the postgres driver, install it with: npm install postgres");
	}
}
