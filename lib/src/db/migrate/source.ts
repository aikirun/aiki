import fs from "node:fs";
import path from "node:path";

import { sha256 } from "../../crypto";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

interface MigrationJournalEntry {
	tag: string;
	when: number;
}

interface MigrationJournal {
	entries: MigrationJournalEntry[];
}

export interface MigrationMeta {
	tag: string;
	sql: string[];
	hash: string;
	folderMillis: number;
}

function buildMigration(entry: MigrationJournalEntry, rawSql: string): MigrationMeta {
	return {
		tag: entry.tag,
		sql: rawSql.split(STATEMENT_BREAKPOINT),
		hash: sha256(rawSql),
		folderMillis: entry.when,
	};
}

export interface MigrationSource {
	read(): MigrationMeta[];
}

// Reads migrations from a package's on-disk migration directory. Used by the
// npm operator bins, where the files sit beside the installed package.
export const directoryMigrationSource = (migrationsDir: string): MigrationSource => ({
	read() {
		const journalPath = path.join(migrationsDir, "meta", "_journal.json");
		let journal: MigrationJournal;
		try {
			journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as MigrationJournal;
		} catch {
			throw new Error(`no migration journal at ${journalPath}`);
		}
		return journal.entries.map((entry) => {
			const rawSql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
			return buildMigration(entry, rawSql);
		});
	},
});

// A package's migrations data: the journal plus each migration's raw SQL
// keyed by tag.
export interface EmbeddedMigrations {
	journal: MigrationJournal;
	files: Record<string, string>;
}

// Reads migrations from embedded data. Used by the standalone binary.
export const embeddedMigrationSource = (embedded: EmbeddedMigrations): MigrationSource => ({
	read() {
		return embedded.journal.entries.map((entry) => {
			const rawSql = embedded.files[entry.tag];
			if (rawSql === undefined) {
				throw new Error(`embedded migrations are missing the SQL for ${entry.tag}`);
			}
			return buildMigration(entry, rawSql);
		});
	},
});
