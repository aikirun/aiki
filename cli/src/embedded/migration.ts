import type { DatabaseProvider } from "@aikirun/lib/db";
import type { Migrations } from "@aikirun/lib/db/migrate";

export const MIGRATION_PACKAGES = ["server", "iam"] as const;
export type MigrationPackage = (typeof MIGRATION_PACKAGES)[number];

export function isMigrationPackage(value: string): value is MigrationPackage {
	for (const pkg of MIGRATION_PACKAGES) {
		if (pkg === value) {
			return true;
		}
	}
	return false;
}

export interface EmbeddedPackageMigrationData {
	migrationsTable: string;
	migrationsByProvider: Partial<Record<DatabaseProvider, Migrations>>;
}

export type EmbeddedMigrationData = {
	version: "1";
	data: Partial<Record<MigrationPackage, EmbeddedPackageMigrationData>>;
};
