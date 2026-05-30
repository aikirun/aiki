import type { SqliteClient, SqliteDb, SqliteHandle } from "./provider";
import { createChildWorkflowRunWaitQueueRepository } from "./repository/child-workflow-run-wait-queue";
import { createEventWaitQueueRepository } from "./repository/event-wait-queue";
import { createScheduleRepository } from "./repository/schedule";
import { createSleepQueueRepository } from "./repository/sleep-queue";
import { createStateTransitionRepository } from "./repository/state-transition";
import { createTaskRepository } from "./repository/task";
import { createWorkflowRepository } from "./repository/workflow";
import { createWorkflowRunRepository } from "./repository/workflow-run";
import { createWorkflowRunOutboxRepository } from "./repository/workflow-run-outbox";
import type { Repositories } from "../types";

// bun:sqlite is synchronous and drizzle's bun-sqlite transactions cannot wrap async
// callbacks. The new Repositories contract hands the transaction an async callback, so
// we serialize all DB access through a single in-process queue and drive BEGIN/COMMIT
// on the raw connection ourselves.
function createTransactionSerializer() {
	let queue: Promise<void> = Promise.resolve();

	return function serialize<T>(fn: () => Promise<T>): Promise<T> {
		let release: () => void;
		const prevQueue = queue;
		queue = new Promise<void>((resolve) => {
			release = resolve;
		});

		return prevQueue.then(async () => {
			try {
				return await fn();
			} finally {
				release?.();
			}
		});
	};
}

export function createSqliteRepos(handle: SqliteHandle, client: SqliteClient): Repositories {
	const serialize = createTransactionSerializer();
	const serializedRepos = wrapSerialized(createRepos(handle), serialize);

	return {
		...serializedRepos,
		async transaction<T>(fn: (txRepos: Omit<Repositories, "transaction">) => Promise<T>): Promise<T> {
			return serialize(async () => {
				client.exec("BEGIN IMMEDIATE");
				try {
					// Use the unserialized repos here: this block already holds the
					// serializer lock, so re-acquiring it per call would deadlock.
					const result = await fn(createRepos(handle));
					client.exec("COMMIT");
					return result;
				} catch (e) {
					try {
						client.exec("ROLLBACK");
					} catch {
						// ROLLBACK throws if SQLite already auto-rolled-back; ignore.
					}
					throw e;
				}
			});
		},
	};
}

function createRepos(db: SqliteDb): Omit<Repositories, "transaction"> {
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
	};
}

function wrapSerialized(
	repos: Omit<Repositories, "transaction">,
	serialize: <T>(fn: () => Promise<T>) => Promise<T>
): Omit<Repositories, "transaction"> {
	const serialized = {} as Record<string, Record<string, unknown>>;

	for (const [repoName, repo] of Object.entries(repos as Record<string, Record<string, unknown>>)) {
		serialized[repoName] = {};
		for (const [methodName, method] of Object.entries(repo)) {
			if (typeof method === "function") {
				serialized[repoName][methodName] = (...args: unknown[]) =>
					serialize(() => (method as (...a: unknown[]) => Promise<unknown>).apply(repo, args));
			}
		}
	}

	return serialized as Omit<Repositories, "transaction">;
}
