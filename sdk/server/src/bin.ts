#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrateCli } from "@aikirun/lib/db/migrate/cli";

import { MIGRATIONS_TABLE } from "./infra/db/migrate";
import packageJson from "../package.json" with { type: "json" };

runMigrateCli({
	name: "aiki-server",
	version: packageJson.version,
	resolveMigrationsDir: (provider) =>
		path.join(path.dirname(fileURLToPath(import.meta.url)), "infra", "db", provider, "migration"),
	migrationsTable: MIGRATIONS_TABLE,
});
