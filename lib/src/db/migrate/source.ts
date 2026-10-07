import fs from "node:fs";
import path from "node:path";

import { sha256 } from "../../crypto";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";
const PREVIOUS_HASHES_FILE = "previous-hashes.json";

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
	// Hashes of the SQL this migration shipped with earlier. A database that recorded one of them
	// has applied this migration.
	previousHashes: string[];
	folderMillis: number;
}

function buildMigration(params: {
	entry: MigrationJournalEntry;
	rawSql: string;
	previousHashes: string[];
}): MigrationMeta {
	return {
		tag: params.entry.tag,
		sql: params.rawSql.split(STATEMENT_BREAKPOINT),
		hash: sha256(params.rawSql),
		previousHashes: params.previousHashes,
		folderMillis: params.entry.when,
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

	const previousHashesPath = path.join(migrationsDir, PREVIOUS_HASHES_FILE);
	if (!fs.existsSync(previousHashesPath)) {
		return { journal, files };
	}
	const previousHashes = JSON.parse(fs.readFileSync(previousHashesPath, "utf8")) as Record<string, string[]>;
	return { journal, files, previousHashes };
}

// A package's migrations data: the journal plus each migration's raw SQL keyed by tag.
export interface Migrations {
	journal: MigrationJournal;
	files: Record<string, string>;
	// By tag, the hashes of the SQL a migration shipped with before its SQL was edited.
	previousHashes?: Record<string, string[]>;
}

export const migrationSource = (migrations: Migrations): MigrationSource => ({
	read() {
		return migrations.journal.entries.map((entry) => {
			const rawSql = migrations.files[entry.tag];
			if (rawSql === undefined) {
				throw new Error(`migrations are missing the SQL for ${entry.tag}`);
			}
			return buildMigration({ entry, rawSql, previousHashes: migrations.previousHashes?.[entry.tag] ?? [] });
		});
	},
});
