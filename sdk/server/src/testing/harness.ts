import { loadDatabaseConfig } from "@aikirun/lib/db";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { redisTimerPriorityQueue } from "@aikirun/redis";
import { type FakePublisher, fakePublisher } from "@aikirun/testing/infra/queue";
import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";
import Redis from "ioredis";

import { daemonContextFactory, namespaceRequestContextFactory } from "./data-factory/middleware/context";
import { resetDatabase } from "./infra/db/reset";
import { afterAll, beforeAll, beforeEach } from "bun:test";
import { database } from "../infra/db";
import { createRepos } from "../infra/db/repo";
import type { Repositories } from "../infra/db/types";
import type { DaemonContext, NamespaceRequestContext } from "../middleware/context";

interface HarnessDeps<Context> {
	repos: Repositories;
	publisher: FakePublisher;
	context: Context;
}

export type DaemonHarnessDeps = HarnessDeps<DaemonContext>;
export type ServiceHarnessDeps = HarnessDeps<NamespaceRequestContext>;

/**
 * Stands up one pooled connection against the database, resets every table before each test,
 * and closes the connection afterwards.
 * The returned function runs a test body with fresh per-test deps: the shared `repos`, a
 * `fakePublisher` (verified on teardown), and the context built for the suite's seam.
 *
 * It is provider-blind — it works against whatever `DATABASE_PROVIDER` points to, going through
 * the same `Database` seam as production repos.
 */
function createHarness<Context>(buildContext: () => Context) {
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

	return async (fn: (deps: HarnessDeps<Context>) => Promise<void>) => {
		if (!repos) {
			throw new Error("Harness deps are only available inside a test — call the returned function in a test body.");
		}
		const publisher = fakePublisher();
		await fn({ context: buildContext(), repos, publisher });
		publisher.verify();
	};
}

/**
 * Harness for daemon suites: the injected context is a `DaemonContext`.
 *
 * @example
 * const withHarness = createDaemonHarness();
 * test("marks rows published", () =>
 *   withHarness(async ({ repos, publisher, context }) => { ... }));
 */
export function createDaemonHarness() {
	return createHarness(() => daemonContextFactory.build());
}

/**
 * Harness for service suites: the injected context is a `NamespaceRequestContext`, the seam a
 * request handler calls the service with.
 *
 * @example
 * const withHarness = createServiceHarness();
 * test("claims a pending row", () =>
 *   withHarness(async ({ repos, context }) => { ... }));
 */
export function createServiceHarness() {
	return createHarness(() => namespaceRequestContextFactory.build());
}

/**
 * Opens a fresh connection with its own `Repositories` for the scope of `fn`.
 * The db connection exists only inside `fn` and is closed on the way out.
 *
 * @example
 * withRepos(async (repos) => { ... }));
 */
export async function withRepos(fn: (repos: Repositories) => Promise<void>): Promise<void> {
	const dbConfig = loadDatabaseConfig();
	const createDb = database(dbConfig);
	const db = await createDb();
	try {
		const repos = await createRepos(db);
		await fn(repos);
	} finally {
		await createDb.close();
	}
}

/**
 * Provides a `TimerPriorityQueue` for the scope of `fn`.
 * `TIMER_PRIORITY_QUEUE_PROVIDER` env variable is read to determine which implementation is used.
 * Supported values are "memory" and "redis". Default is "memory".
 *
 * @example
 * withTimerPriorityQueue(async (queue) => { ... });
 */
export async function withTimerPriorityQueue(fn: (queue: TimerPriorityQueue) => Promise<void>): Promise<void> {
	const provider = process.env.TIMER_PRIORITY_QUEUE_PROVIDER ?? "memory";
	const abortController = new AbortController();
	try {
		switch (provider) {
			case "memory": {
				const queue = inMemoryTimerPriorityQueue()({ logger: noopLogger, signal: abortController.signal });
				await fn(queue);
				return;
			}
			case "redis": {
				const redisClient = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
				redisClient.on("error", () => {});
				try {
					const timersKey = "aiki:timers";
					await redisClient.del(timersKey, `${timersKey}:signal`);
					const queue = redisTimerPriorityQueue(
						redisClient,
						timersKey
					)({
						logger: noopLogger,
						signal: abortController.signal,
					});
					await fn(queue);
				} finally {
					await redisClient.quit();
				}
				return;
			}
			default:
				throw new Error(`Unsupported TIMER_PRIORITY_QUEUE_PROVIDER: ${provider}. Must be one of "memory, redis"`);
		}
	} finally {
		abortController.abort();
	}
}
