import { type MigrationsDatabase, readAppliedMigrations, readMigrationsTableState } from "./migrations-table";
import type { MigrationJournal } from "./source";
import type { Logger } from "../../logger";

export interface ReportPendingMigrationsParams {
	name: string;
	docsUrl: string;
	migrationsTable: string;
	journal: MigrationJournal;
	db: MigrationsDatabase;
	logger: Logger;
}

const reportsByTableByClient = new WeakMap<object, Map<string, Promise<void>>>();

// Logs the migrations the journal lists that the database has not applied, once per migrations
// table of a client, however many times it is asked. It never rejects, so a caller need not wait
// for it.
export function reportPendingMigrations(params: ReportPendingMigrationsParams): Promise<void> {
	let reportsByTable = reportsByTableByClient.get(params.db.client);
	if (!reportsByTable) {
		reportsByTable = new Map();
		reportsByTableByClient.set(params.db.client, reportsByTable);
	}
	let report = reportsByTable.get(params.migrationsTable);
	if (!report) {
		report = logPendingMigrations(params);
		reportsByTable.set(params.migrationsTable, report);
	}
	return report;
}

async function logPendingMigrations(params: ReportPendingMigrationsParams): Promise<void> {
	const { name, docsUrl, migrationsTable, journal, db, logger } = params;

	try {
		const migrationsTableState = await readMigrationsTableState(db, migrationsTable);
		switch (migrationsTableState) {
			case "no_table":
				logger.error(`The database has none of ${name}'s migrations. Apply them: ${docsUrl}`);
				return;
			case "untagged":
				logger.warn(`The database's ${name} migrations predate this version. Apply them: ${docsUrl}`);
				return;
			case "tagged": {
				const appliedMigrations = await readAppliedMigrations(db, migrationsTable);
				const pendingTags = findPendingMigrationTags(
					journal,
					appliedMigrations.map((appliedMigration) => appliedMigration.tag)
				);
				if (pendingTags.length > 0) {
					logger.warn(
						`The database is missing ${pendingTags.length} of ${name}'s migrations: ${pendingTags.join(", ")}. Apply them: ${docsUrl}`
					);
				}
				return;
			}
			default:
				migrationsTableState satisfies never;
		}
	} catch (err) {
		logger.warn(`Couldn't check ${name}'s migrations`, { err });
	}
}

// Tags the journal lists that the database has not applied.
// A database that a newer version migrated has applied tags this journal doesn't list; they are not pending.
export function findPendingMigrationTags(journal: MigrationJournal, appliedTags: string[]): string[] {
	const appliedTagSet = new Set(appliedTags);
	return journal.entries.map((entry) => entry.tag).filter((tag) => !appliedTagSet.has(tag));
}
