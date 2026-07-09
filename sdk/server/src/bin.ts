#!/usr/bin/env node
import { runMigrateCli } from "@aikirun/lib/db/migrate/cli";

import { MIGRATIONS_TABLE, migrationSource } from "./migrate";
import packageJson from "../package.json" with { type: "json" };

await runMigrateCli({
	name: "aiki-server",
	version: packageJson.version,
	resolveSource: migrationSource,
	migrationsTable: MIGRATIONS_TABLE,
});
