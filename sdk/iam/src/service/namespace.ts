import { fireAndForget } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import { ForbiddenError, ValidationError } from "@aikirun/lib/error";
import type { Cache } from "@aikirun/types/infra/cache";
import type { NamespaceId, NamespaceRole } from "@aikirun/types/namespace";
import { ulid } from "ulidx";

import type { ApiKeyAuthorizationInfo } from "./api-key";
import {
	isOrganizationManager,
	type OrganizationManagerSessionRequestContext,
	type OrganizationSessionRequestContext,
} from "../context";
import type { NamespaceInfo, NamespaceMemberInfo, NamespaceMemberInput } from "../contract/schema/namespace";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { NamespaceRow } from "../infra/db/types/namespace";

export interface NamespaceServiceDeps {
	repos: Repositories;
	apiKeyCache?: Cache<ApiKeyAuthorizationInfo>;
}

export const createNamespaceService = ({ repos, apiKeyCache }: NamespaceServiceDeps) => ({
	async createNamespaceWithMember(
		context: OrganizationManagerSessionRequestContext,
		params: { name: string }
	): Promise<NamespaceRow> {
		return repos.transaction(async (txRepos) => createNamespaceWithMemberInTx(context, params, txRepos));
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

	async listNamespacesForUser(
		context: OrganizationManagerSessionRequestContext,
		userId: string
	): Promise<NamespaceInfo[]> {
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

	async namespaceExists(context: OrganizationSessionRequestContext, namespaceId: NamespaceId): Promise<boolean> {
		return repos.namespace.exists({ organizationId: context.organizationId, namespaceId: namespaceId });
	},

	async setMembership(
		_context: OrganizationSessionRequestContext,
		namespaceId: NamespaceId,
		members: NonEmptyArray<NamespaceMemberInput>
	): Promise<void> {
		if (isNonEmptyArray(members)) {
			await repos.transaction(async (txRepos) => setMembershipInTx(_context, namespaceId, members, txRepos));
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

	async softDeleteNamespaceById(
		context: OrganizationManagerSessionRequestContext,
		namespaceId: NamespaceId
	): Promise<void> {
		const revokedKeyHashes = await repos.transaction(async (txRepos) =>
			softDeleteNamespaceByIdInTx(context, namespaceId, txRepos)
		);
		if (apiKeyCache && isNonEmptyArray(revokedKeyHashes)) {
			fireAndForget(apiKeyCache.invalidate(revokedKeyHashes), (_error) => {});
		}
	},
});

export type NamespaceService = ReturnType<typeof createNamespaceService>;

async function createNamespaceWithMemberInTx(
	context: OrganizationManagerSessionRequestContext,
	params: { name: string },
	txRepos: TxRepositories
) {
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
}

async function setMembershipInTx(
	_context: OrganizationSessionRequestContext,
	namespaceId: NamespaceId,
	members: NonEmptyArray<NamespaceMemberInput>,
	txRepos: TxRepositories
) {
	await txRepos.namespace.upsertMembers(namespaceId, members);
}

async function softDeleteNamespaceByIdInTx(
	context: OrganizationManagerSessionRequestContext,
	namespaceId: NamespaceId,
	txRepos: TxRepositories
) {
	const activeNamespaceCount = await txRepos.namespace.countActiveByOrganizationForUpdate(context.organizationId);
	if (activeNamespaceCount <= 1) {
		throw new ValidationError("Cannot delete the last namespace");
	}
	await txRepos.namespace.softDelete(namespaceId);
	await txRepos.session.clearActiveByNamespaceId(namespaceId);
	return txRepos.apiKey.revokeByNamespace(namespaceId);
}
