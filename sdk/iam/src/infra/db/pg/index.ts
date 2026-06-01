import { createPgHandle, type PgClient, type PgDb } from "./provider";
import { createApiKeyRepository } from "./repository/api-key";
import { createNamespaceRepository } from "./repository/namespace";
import { createOrganizationRepository } from "./repository/organization";
import { createSessionRepository } from "./repository/session";
import type { Repositories } from "../types";

export function createPgRepos(client: PgClient): Repositories {
	const db = createPgHandle(client);
	return {
		...createRepos(db),
		async transaction<T>(fn: (txRepos: Omit<Repositories, "transaction">) => Promise<T>): Promise<T> {
			return db.transaction(async (tx) => fn(createRepos(tx)));
		},
	};
}

function createRepos(db: PgDb): Omit<Repositories, "transaction"> {
	return {
		namespace: createNamespaceRepository(db),
		organization: createOrganizationRepository(db),
		session: createSessionRepository(db),
		apiKey: createApiKeyRepository(db),
	};
}
