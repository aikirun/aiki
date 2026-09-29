import { createSqliteHandle, type SqliteClient, type SqliteDb } from "./provider";
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
			return db.transaction(async (tx) => fn(createRepos(tx) as TxRepositories));
		},
	};
}
