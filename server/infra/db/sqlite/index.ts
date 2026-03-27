import type { SqliteDatabaseConn } from "./provider";
import { createApiKeyRepository } from "./repository/api-key";
import { createChildWorkflowRunWaitQueueRepository } from "./repository/child-workflow-run-wait-queue";
import { createEventWaitQueueRepository } from "./repository/event-wait-queue";
import { createNamespaceRepository } from "./repository/namespace";
import { createScheduleRepository } from "./repository/schedule";
import { createSleepQueueRepository } from "./repository/sleep-queue";
import { createStateTransitionRepository } from "./repository/state-transition";
import { createTaskRepository } from "./repository/task";
import { createWorkflowRepository } from "./repository/workflow";
import { createWorkflowRunRepository } from "./repository/workflow-run";
import { createWorkflowRunOutboxRepository } from "./repository/workflow-run-outbox";
import type { Database } from "bun:sqlite";
import type { Repositories } from "../types";

function createTransactionSerializer() {
	let queue: Promise<void> = Promise.resolve();

	return function serialize<T>(fn: () => Promise<T>): Promise<T> {
		let resolve: () => void;
		const prevQueue = queue;
		queue = new Promise<void>((r) => {
			resolve = r;
		});

		return prevQueue.then(async () => {
			try {
				return await fn();
			} finally {
				resolve?.();
			}
		});
	};
}

export function createSqliteRepositories(conn: SqliteDatabaseConn, raw: Database): Repositories {
	const serialize = createTransactionSerializer();

	const repos = createSerializedRepos(conn, serialize);

	return {
		...repos,
		async transaction<T>(fn: (txRepos: Omit<Repositories, "transaction">) => Promise<T>): Promise<T> {
			return serialize(async () => {
				raw.exec("BEGIN IMMEDIATE");
				try {
					// IMPORTANT: Use createRepos(conn) here — NOT the serialized repos.
					// This block already holds the serializer lock. Using serialized repos
					// would deadlock because each DB call would try to re-acquire the lock.
					const result = await fn(createRepos(conn));
					raw.exec("COMMIT");
					return result;
				} catch (e) {
					try {
						raw.exec("ROLLBACK");
					} catch {
						// ROLLBACK may throw if SQLite already auto-rolled-back
					}
					throw e;
				}
			});
		},
	};
}

function createRepos(db: SqliteDatabaseConn): Omit<Repositories, "transaction"> {
	return {
		workflowRun: createWorkflowRunRepository(db),
		task: createTaskRepository(db),
		stateTransition: createStateTransitionRepository(db),
		schedule: createScheduleRepository(db),
		workflow: createWorkflowRepository(db),
		sleepQueue: createSleepQueueRepository(db),
		eventWaitQueue: createEventWaitQueueRepository(db),
		childWorkflowRunWaitQueue: createChildWorkflowRunWaitQueueRepository(db),
		workflowRunOutbox: createWorkflowRunOutboxRepository(db),
		namespace: createNamespaceRepository(db),
		apiKey: createApiKeyRepository(db),
	};
}

function createSerializedRepos(
	db: SqliteDatabaseConn,
	serialize: <T>(fn: () => Promise<T>) => Promise<T>
): Omit<Repositories, "transaction"> {
	const raw = createRepos(db);
	const serialized = {} as Record<string, Record<string, unknown>>;

	for (const [repoName, repo] of Object.entries(raw)) {
		serialized[repoName] = {};
		for (const [methodName, method] of Object.entries(repo as Record<string, unknown>)) {
			if (typeof method === "function") {
				serialized[repoName][methodName] = (...args: unknown[]) =>
					serialize(() => (method as (...a: unknown[]) => Promise<unknown>).apply(repo, args));
			}
		}
	}

	return serialized as Omit<Repositories, "transaction">;
}
