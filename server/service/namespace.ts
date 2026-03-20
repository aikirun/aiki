import { isNonEmptyArray } from "@aikirun/lib";
import { fireAndForget } from "@aikirun/lib/async";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { NamespaceInfo } from "@aikirun/types/namespace-api";
import { ValidationError } from "server/errors";
import type { NamespaceRow, Repositories } from "server/infra/db/types";
import {
	isOrganizationManager,
	type OrganizationManagerSessionRequestContext,
	type OrganizationSessionRequestContext,
} from "server/middleware/context";
import { ulid } from "ulidx";

import type { ApiKeyService } from "./api-key";

export function createNamespaceService(
	repos: Pick<Repositories, "namespace" | "session" | "transaction">,
	apiKeyService: ApiKeyService
) {
	return {
		async createNamespaceWithMember(
			context: OrganizationManagerSessionRequestContext,
			params: { name: string }
		): Promise<NamespaceRow> {
			return repos.transaction(async (txRepos) => {
				const namespaceId = ulid();
				const createdNamespace = await txRepos.namespace.create({
					id: namespaceId,
					name: params.name,
					organizationId: context.organizationId,
				});
				await txRepos.namespace.createMember({
					id: ulid(),
					namespaceId,
					userId: context.userId,
					role: "admin",
				});
				return createdNamespace;
			});
		},

		async listNamespacesForUser(context: OrganizationSessionRequestContext): Promise<NamespaceInfo[]> {
			if (!isOrganizationManager(context)) {
				const namespacesWithRole = await repos.namespace.listByUser(context.organizationId, context.userId);
				return namespacesWithRole.map((namespace) => ({
					id: namespace.id,
					name: namespace.name,
					organizationId: namespace.organizationId,
					role: namespace.role,
					createdAt: namespace.createdAt,
				}));
			}
			const namespaces = await repos.namespace.listByOrganization(context.organizationId);
			return namespaces.map((namespace) => ({
				id: namespace.id,
				name: namespace.name,
				organizationId: namespace.organizationId,
				role: "admin",
				createdAt: namespace.createdAt,
			}));
		},

		async softDeleteNamespaceId(
			context: OrganizationManagerSessionRequestContext,
			namespaceId: NamespaceId
		): Promise<void> {
			const revokedKeyHashes = await repos.transaction(async (txRepos) => {
				const activeNamespaceCount = await txRepos.namespace.countActiveByOrganizationForUpdate(context.organizationId);
				if (activeNamespaceCount <= 1) {
					throw new ValidationError("Cannot delete the last namespace");
				}
				await txRepos.namespace.softDelete(namespaceId);
				await txRepos.session.clearActiveByNamespaceId(namespaceId);
				return apiKeyService.revokeByNamespaceId(namespaceId, txRepos.apiKey);
			});

			if (isNonEmptyArray(revokedKeyHashes)) {
				fireAndForget(apiKeyService.invalidateCacheByHashes(revokedKeyHashes), (_error) => {});
			}
		},
	};
}

export type NamespaceService = ReturnType<typeof createNamespaceService>;
