import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { directoryMigrationSource, type EmbeddedMigrations, embeddedMigrationSource } from "./source";
import { afterAll, describe, expect, test } from "bun:test";

// A fixture migration folder shaped like drizzle-kit's output.
const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-source-"));
fs.mkdirSync(path.join(migrationsDir, "meta"), { recursive: true });

const journal = {
	version: "7",
	dialect: "postgresql",
	entries: [
		{ idx: 0, version: "7", when: 1_700_000_000_000, tag: "0000_initial", breakpoints: true },
		{ idx: 1, version: "7", when: 1_700_000_001_000, tag: "0001_add_column", breakpoints: true },
	],
};
fs.writeFileSync(path.join(migrationsDir, "meta", "_journal.json"), JSON.stringify(journal));
fs.writeFileSync(
	path.join(migrationsDir, "0000_initial.sql"),
	"CREATE TABLE workflow (id text PRIMARY KEY);\n--> statement-breakpoint\nCREATE INDEX ix ON workflow (id);"
);
fs.writeFileSync(path.join(migrationsDir, "0001_add_column.sql"), "ALTER TABLE workflow ADD COLUMN name text;");

afterAll(() => fs.rmSync(migrationsDir, { recursive: true, force: true }));

describe("directoryMigrationSource", () => {
	test("matches drizzle's readMigrationFiles", () => {
		const comparable = (migration: { hash: string; sql: string[]; folderMillis: number }) => ({
			hash: migration.hash,
			sql: migration.sql,
			folderMillis: migration.folderMillis,
		});
		const actualMigrations = directoryMigrationSource(migrationsDir).read();
		const expectedMigrations = readMigrationFiles({ migrationsFolder: migrationsDir });

		expect(actualMigrations.map(comparable)).toEqual(expectedMigrations.map(comparable));
	});
});

describe("embeddedMigrationSource", () => {
	test("produces the same migrations as the folder it was generated from", () => {
		const embedded: EmbeddedMigrations = {
			journal: { entries: journal.entries.map((entry) => ({ tag: entry.tag, when: entry.when })) },
			files: {
				"0000_initial": fs.readFileSync(path.join(migrationsDir, "0000_initial.sql"), "utf8"),
				"0001_add_column": fs.readFileSync(path.join(migrationsDir, "0001_add_column.sql"), "utf8"),
			},
		};

		expect(embeddedMigrationSource(embedded).read()).toEqual(directoryMigrationSource(migrationsDir).read());
	});

	test("throws when a tag has no embedded SQL", () => {
		const embedded: EmbeddedMigrations = {
			journal: { entries: [{ tag: "0000_initial", when: 1 }] },
			files: {},
		};
		expect(() => embeddedMigrationSource(embedded).read()).toThrow("0000_initial");
	});
});
