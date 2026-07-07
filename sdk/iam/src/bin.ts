#!/usr/bin/env node
import { runMigrateCli } from "@aikirun/lib/db/migrate/cli";

import { MIGRATIONS_TABLE, migrationSource } from "./infra/db/migrate";
import packageJson from "../package.json" with { type: "json" };

runMigrateCli({
	name: "aiki-iam",
	version: packageJson.version,
	resolveSource: migrationSource,
	migrationsTable: MIGRATIONS_TABLE,
});
