// biome-ignore-all lint/suspicious/noConsole: this prints command output, not logs
import fs from "node:fs";
import path from "node:path";

import type { DatabaseProvider } from "../../db";

interface JournalEntry {
	tag: string;
}

interface MigrationJournal {
	entries: JournalEntry[];
}

interface MigrateListParams {
	migrationsDir: string;
	dbProvider: DatabaseProvider;
}

export async function migrateList(params: MigrateListParams): Promise<void> {
	const journalPath = path.join(params.migrationsDir, "meta", "_journal.json");

	let journalText: string;
	try {
		journalText = await fs.promises.readFile(journalPath, "utf8");
	} catch {
		throw new Error(`no migration journal at ${journalPath}`);
	}

	const journal = JSON.parse(journalText) as MigrationJournal;
	if (!Array.isArray(journal.entries)) {
		throw new Error(`malformed migration journal at ${journalPath}`);
	}

	console.log(`${params.dbProvider}: ${journal.entries.length} migration(s)`);
	for (const entry of journal.entries) {
		console.log(`  ${entry.tag}`);
	}
}
