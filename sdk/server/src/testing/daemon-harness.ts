import { loadDatabaseConfig } from "@aikirun/lib/db";
import { createConsoleLogger } from "@aikirun/lib/logger";
import { type FakePublisher, fakePublisher } from "@aikirun/testing/infra/queue";
import type { CreateDatabase, Database } from "@aikirun/types/infra/db";

import { resetDatabase } from "./infra/db/reset";
import { afterAll, beforeAll, beforeEach } from "bun:test";
import { database } from "../infra/db";
import { createRepos } from "../infra/db/repo";
import type { Repositories } from "../infra/db/types";
import { createDaemonContext, type DaemonContext } from "../middleware/context";

export interface DaemonHarnessDeps {
	repos: Repositories;
	publisher: FakePublisher;
	context: DaemonContext;
}

/**
 * Stands up one pooled connection against the database, resets every table before each test,
 * and closes the connection afterwards.
 * The returned function runs a test body with fresh per-test deps:
 * the shared `repos`, a `fakePublisher`, and a `DaemonContext`.
 *
 * It is provider-blind — it works against whatever `DATABASE_PROVIDER` points to, going through the
 * same `Database` seam as production repos.
 *
 * @example
 * const withHarness = createDaemonHarness();
 * test("marks rows published", () =>
 *   withHarness(async ({ repos, publisher, context }) => { ... }));
 */
export function createDaemonHarness() {
	let createDb: CreateDatabase | undefined;
	let db: Database | undefined;
	let repos: Repositories | undefined;

	beforeAll(async () => {
		const dbConfig = loadDatabaseConfig();
		createDb = database(dbConfig);
		db = await createDb();
		repos = await createRepos(db);
	});

	beforeEach(async () => {
		if (db) {
			await resetDatabase(db);
		}
	});

	afterAll(async () => {
		await createDb?.close();
	});

	return (fn: (deps: DaemonHarnessDeps) => Promise<void>) => {
		if (!repos) {
			throw new Error(
				`${createDaemonHarness.name} deps are only available inside a test — call the returned function in a test body.`
			);
		}
		return fn({
			context: createDaemonContext({
				name: "test",
				logger: createConsoleLogger({ level: "ERROR" }),
				signal: new AbortController().signal,
			}),
			repos,
			publisher: fakePublisher(),
		});
	};
}
