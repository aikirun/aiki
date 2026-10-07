import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migration");

// drizzle-kit rebuilds a table as __new_<table> and then renames it. A constraint written against
// the temporary name has to be rewritten by that rename, which the SQLite that ships with macOS
// does not do, so the migration fails there. A column named on its own needs no rewriting.
test("no migration names a temporary table in front of a column", () => {
	const migrationFiles = fs.readdirSync(migrationsDir).filter((fileName) => fileName.endsWith(".sql"));

	expect(migrationFiles.length).toBeGreaterThan(0);
	expect(
		migrationFiles.filter((fileName) =>
			/"__new_\w+"\./.test(fs.readFileSync(path.join(migrationsDir, fileName), "utf8"))
		)
	).toEqual([]);
});
