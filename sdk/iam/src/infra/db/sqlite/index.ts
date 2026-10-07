import type { SqliteClient } from "@aikirun/lib/db/sqlite";

import { createSqliteHandle, type SqliteDb } from "./provider";
import { createApiKeyRepository } from "./repository/api-key";
import { createNamespaceRepository } from "./repository/namespace";
import { createOrganizationRepository } from "./repository/organization";
import { createSessionRepository } from "./repository/session";
import type { Repositories, TxRepositories } from "../types";

const createRepos = (db: SqliteDb): Omit<Repositories, "transaction"> => ({
	namespace: createNamespaceRepository(db),
	organization: createOrganizationRepository(db),
	session: createSessionRepository(db),
	apiKey: createApiKeyRepository(db),
});

export function createSqliteRepos(client: SqliteClient): Repositories {
	const db = createSqliteHandle(client);
	return {
		...createRepos(db),
		async transaction<T>(fn: (txRepos: TxRepositories) => Promise<T>): Promise<T> {
			const transaction = await client.transaction();
			let result: T;
			try {
				result = await fn(createRepos(createSqliteHandle(transaction)) as TxRepositories);
				await transaction.commit();
			} catch (error) {
				await transaction.rollback();
				throw error;
			}
			return result;
		},
	};
}
