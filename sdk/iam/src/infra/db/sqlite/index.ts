import type { SqliteClient, SqliteDb, SqliteHandle } from "./provider";
import { createApiKeyRepository } from "./repository/api-key";
import { createNamespaceRepository } from "./repository/namespace";
import { createOrganizationRepository } from "./repository/organization";
import { createSessionRepository } from "./repository/session";
import type { Repositories } from "../types";

// bun:sqlite is synchronous and drizzle's bun-sqlite transactions cannot wrap async
// callbacks, so serialize all DB access through a single queue and drive BEGIN/COMMIT
// on the raw connection. NOTE: this serializer is scoped to the iam repositories; it
// does not coordinate with the server package's serializer over the same connection
// (see PR notes on cross-package transactions).
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
		namespace: createNamespaceRepository(db),
		organization: createOrganizationRepository(db),
		session: createSessionRepository(db),
		apiKey: createApiKeyRepository(db),
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
