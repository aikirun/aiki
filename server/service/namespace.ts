import type { NamespaceRepository, NamespaceRow } from "../infra/db/repository/namespace";

export function createNamespaceService(namespaceRepository: NamespaceRepository) {
	return {
		async createNamespaceWithMember(params: {
			name: string;
			organizationId: string;
			userId: string;
		}): Promise<NamespaceRow> {
			const createdNamespace = await namespaceRepository.createWithMember(
				{ name: params.name, organizationId: params.organizationId },
				{ userId: params.userId, role: "admin" }
			);

			return createdNamespace;
		},
	};
}

export type NamespaceService = ReturnType<typeof createNamespaceService>;
