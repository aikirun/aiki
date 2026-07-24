import { loadDatabaseConfig } from "@aikirun/lib/db";
import { createConsoleLogger } from "@aikirun/lib/logger";
import { type FakePublisher, fakePublisher } from "@aikirun/testing/infra/queue";
import type { Database } from "@aikirun/types/infra/db";

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
 * Stands up one pooled connection for the test file against the database from `loadDatabaseConfig()`,
 * resets every table before each test, and closes the connection afterwards. The returned function runs
 * a test body with fresh per-test deps: the shared `repos`, a `fakePublisher`, and a `DaemonContext`.
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
	const createDatabase = database(loadDatabaseConfig());
	let db: Database;
	let repos: Repositories;

	beforeAll(async () => {
		db = await createDatabase();
		repos = await createRepos(db);
	});

	beforeEach(async () => {
		await resetDatabase(db);
	});

	afterAll(async () => {
		await createDatabase.close();
	});

	return (fn: (deps: DaemonHarnessDeps) => Promise<void>) =>
		fn({
			repos,
			publisher: fakePublisher(),
			context: createDaemonContext({
				name: "test",
				logger: createConsoleLogger({ level: "ERROR" }),
				signal: new AbortController().signal,
			}),
		});
}
