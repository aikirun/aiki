import type { ApiKeyRepository } from "./api-key";
import type { NamespaceRepository } from "./namespace";
import type { OrganizationRepository } from "./organization";
import type { SessionRepository } from "./session";

export interface Repositories {
	namespace: NamespaceRepository;
	organization: OrganizationRepository;
	session: SessionRepository;
	apiKey: ApiKeyRepository;
	transaction<T>(fn: (txRepos: Omit<Repositories, "transaction">) => Promise<T>): Promise<T>;
}
