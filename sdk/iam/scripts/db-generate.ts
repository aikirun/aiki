import path from "node:path";
import process from "node:process";
import { migrateGenerate } from "@aikirun/lib/migrate";

const packageRoot = path.resolve(import.meta.dirname, "..");

await migrateGenerate({
	packageRoot,
	resolveSchemaDir: (provider) => path.join(packageRoot, "src", "infra", "db", provider),
	resolveMigrationsDir: (provider) => path.join(packageRoot, "src", "infra", "db", provider, "migration"),
	custom: process.argv.includes("--custom"),
});
