import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/array";
import { fireAndForget } from "@aikirun/lib/async";
import type { NamespaceId, NamespaceRole } from "@aikirun/types/namespace";
import type { NamespaceInfo, NamespaceMemberInfo, NamespaceMemberInput } from "@aikirun/types/namespace-api";
import { ForbiddenError, ValidationError } from "server/errors";
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
				const createdNamespace = await txRepos.namespace.create({
					name: params.name,
					organizationId: context.organizationId,
				});
				await txRepos.namespace.createMember({
					id: ulid(),
					namespaceId: createdNamespace.id,
					userId: context.userId,
					role: "admin",
				});
				return createdNamespace;
			});
		},

		async listNamespaces(context: OrganizationSessionRequestContext): Promise<NamespaceInfo[]> {
			if (!isOrganizationManager(context)) {
				const namespaces = await repos.namespace.listByUser(context.organizationId, context.userId);
				return namespaces.map((namespace) => ({
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

		async listNamespacesForUser(context: OrganizationSessionRequestContext, userId: string): Promise<NamespaceInfo[]> {
			const namespaces = await repos.namespace.listByUser(context.organizationId, userId);
			return namespaces.map((namespace) => ({
				id: namespace.id,
				name: namespace.name,
				organizationId: namespace.organizationId,
				role: namespace.role,
				createdAt: namespace.createdAt,
			}));
		},

		async resolveRole(context: OrganizationSessionRequestContext, namespaceId: NamespaceId): Promise<NamespaceRole> {
			if (isOrganizationManager(context)) {
				return "admin";
			}
			const member = await repos.namespace.getMember(namespaceId, context.userId);
			if (!member) {
				throw new ForbiddenError("Not a member of this namespace");
			}
			return member.role;
		},

		async setMembership(
			_context: OrganizationSessionRequestContext,
			namespaceId: NamespaceId,
			members: NonEmptyArray<NamespaceMemberInput>
		): Promise<void> {
			if (isNonEmptyArray(members)) {
				await repos.transaction(async (txRepos) => {
					await txRepos.namespace.upsertMembers(namespaceId, members);
				});
			}
		},

		async removeMembership(
			_context: OrganizationSessionRequestContext,
			namespaceId: NamespaceId,
			userId: string
		): Promise<void> {
			await repos.namespace.removeMember(namespaceId, userId);
		},

		async listMembers(
			_context: OrganizationSessionRequestContext,
			namespaceId: NamespaceId
		): Promise<NamespaceMemberInfo[]> {
			return repos.namespace.listMembers(namespaceId);
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
