import type { OrganizationId } from "@aikirun/types/organization";
import type { NamespaceRow, Repositories } from "server/infra/db/types";
import { ulid } from "ulidx";

export function createNamespaceService(repos: Pick<Repositories, "namespace" | "transaction">) {
	return {
		async createNamespaceWithMember(params: {
			name: string;
			organizationId: OrganizationId;
			userId: string;
		}): Promise<NamespaceRow> {
			return repos.transaction(async (txRepos) => {
				const namespaceId = ulid();
				const createdNamespace = await txRepos.namespace.create({
					id: namespaceId,
					name: params.name,
					organizationId: params.organizationId,
				});
				await txRepos.namespace.createMember({
					id: ulid(),
					namespaceId,
					userId: params.userId,
					role: "admin",
				});
				return createdNamespace;
			});
		},
	};
}

export type NamespaceService = ReturnType<typeof createNamespaceService>;
