import fs from "node:fs";
import path from "node:path";

import { sha256 } from "../../crypto";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

interface MigrationJournalEntry {
	tag: string;
	when: number;
}

export interface MigrationJournal {
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

export function readMigrationsDirectory(migrationsDir: string): Migrations {
	const journalPath = path.join(migrationsDir, "meta", "_journal.json");
	let journal: MigrationJournal;
	try {
		journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as MigrationJournal;
	} catch {
		throw new Error(`no migration journal at ${journalPath}`);
	}
	const files: Record<string, string> = {};
	for (const entry of journal.entries) {
		const rawSql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
		files[entry.tag] = rawSql;
	}
	return { journal, files };
}

// A package's migrations data: the journal plus each migration's raw SQL keyed by tag.
export interface Migrations {
	journal: MigrationJournal;
	files: Record<string, string>;
}

export const migrationSource = (migrations: Migrations): MigrationSource => ({
	read() {
		return migrations.journal.entries.map((entry) => {
			const rawSql = migrations.files[entry.tag];
			if (rawSql === undefined) {
				throw new Error(`migrations are missing the SQL for ${entry.tag}`);
			}
			return buildMigration(entry, rawSql);
		});
	},
});
