import type { DatabaseProvider } from "../../provider";
import type { MigrationSource } from "../source";

interface MigrateListParams {
	source: MigrationSource;
	dbProvider: DatabaseProvider;
}

export function migrateList(params: MigrateListParams): void {
	const migrations = params.source.read();

	console.log(`${params.dbProvider}: ${migrations.length} migration(s)`);
	for (const migration of migrations) {
		console.log(`  ${migration.tag}`);
	}
}
