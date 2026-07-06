// biome-ignore-all lint/suspicious/noConsole: this prints command output, not logs
import fs from "node:fs";
import path from "node:path";
import { loadDatabaseProvider } from "@aikirun/lib/db";

import { loadEnv } from "../lib/env";
import { resolveMigrationsFolder, type SupportedPackage } from "../lib/resolve-package";

interface MigrateListOptions {
	pkg: SupportedPackage;
	envFile?: string;
}

interface JournalEntry {
	tag: string;
}

interface Journal {
	entries: JournalEntry[];
}

// Lists the migrations a package ships, reading only the migration journal —
// no database connection.
export async function migrateList(options: MigrateListOptions): Promise<void> {
	loadEnv(options.envFile);
	const provider = loadDatabaseProvider();

	const migrationsFolder = resolveMigrationsFolder(options.pkg, provider);
	const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

	let journalText: string;
	try {
		journalText = await fs.promises.readFile(journalPath, "utf8");
	} catch {
		throw new Error(
			`no migration journal at ${journalPath} — the @aikirun/${options.pkg} build shipped without its ${provider} migrations`
		);
	}

	const journal = JSON.parse(journalText) as Journal;
	if (!Array.isArray(journal.entries)) {
		throw new Error(`malformed migration journal at ${journalPath}`);
	}

	console.log(`@aikirun/${options.pkg} (${provider}): ${journal.entries.length} migration(s)`);
	for (const entry of journal.entries) {
		console.log(`  ${entry.tag}`);
	}
}
