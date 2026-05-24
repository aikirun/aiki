import { isNonEmptyArray } from "@aikirun/lib/array";
import type { NamespaceId } from "@aikirun/types/namespace";

import { organizationAuthedImplementer } from "./implementer";
import { ForbiddenError, NotFoundError } from "../../errors";
import {
	isOrganizationManager,
	type OrganizationManagerSessionRequestContext,
	type OrganizationSessionRequestContext,
} from "../organization-context";
import type { NamespaceService } from "../service/namespace";

export function createNamespaceRouter(namespaceService: NamespaceService) {
	const os = organizationAuthedImplementer.namespace;

	async function assertNamespaceBelongsToOrganization(
		context: OrganizationSessionRequestContext,
		namespaceId: NamespaceId
	): Promise<void> {
		const exists = await namespaceService.namespaceExists(context, namespaceId);
		if (!exists) {
			throw new NotFoundError("Namespace not found");
		}
	}

	const createV1 = os.createV1.handler(async ({ input, context }) => {
		assertIsOrganizationManager(context);
		const createdNamespace = await namespaceService.createNamespaceWithMember(context, {
			name: input.name,
		});
		return { namespace: { ...createdNamespace, role: "admin" } };
	});

	const listV1 = os.listV1.handler(async ({ context }) => {
		const namespaces = await namespaceService.listNamespaces(context);
		return { namespaces };
	});

	const deleteV1 = os.deleteV1.handler(async ({ input, context }) => {
		assertIsOrganizationManager(context);
		const namespaceId = input.id as NamespaceId;
		await assertNamespaceBelongsToOrganization(context, namespaceId);
		await namespaceService.softDeleteNamespaceById(context, namespaceId);
	});

	const listForUserV1 = os.listForUserV1.handler(async ({ input, context }) => {
		assertIsOrganizationManager(context);
		const namespaces = await namespaceService.listNamespacesForUser(context, input.userId);
		return { namespaces };
	});

	const setMembershipV1 = os.setMembershipV1.handler(async ({ input, context }) => {
		if (!isNonEmptyArray(input.members)) {
			return;
		}
		const namespaceId = input.id as NamespaceId;
		await assertNamespaceBelongsToOrganization(context, namespaceId);
		const namespaceRole = await namespaceService.resolveRole(context, namespaceId);
		if (namespaceRole !== "admin") {
			throw new ForbiddenError("Requires namespace admin role");
		}
		await namespaceService.setMembership(context, namespaceId, input.members);
	});

	const removeMembershipV1 = os.removeMembershipV1.handler(async ({ input, context }) => {
		const namespaceId = input.id as NamespaceId;
		await assertNamespaceBelongsToOrganization(context, namespaceId);
		const namespaceRole = await namespaceService.resolveRole(context, namespaceId);
		if (namespaceRole !== "admin") {
			throw new ForbiddenError("Requires namespace admin role");
		}
		await namespaceService.removeMembership(context, namespaceId, input.userId);
	});

	const listMembersV1 = os.listMembersV1.handler(async ({ input, context }) => {
		const namespaceId = input.id as NamespaceId;
		await assertNamespaceBelongsToOrganization(context, namespaceId);
		const namespaceRole = await namespaceService.resolveRole(context, namespaceId);
		if (namespaceRole !== "admin" && namespaceRole !== "member") {
			throw new ForbiddenError("Requires namespace admin/member role");
		}
		const members = await namespaceService.listMembers(context, namespaceId);
		return { members };
	});

	return os.router({
		createV1,
		listV1,
		deleteV1,
		listForUserV1,
		setMembershipV1,
		removeMembershipV1,
		listMembersV1,
	});
}

function assertIsOrganizationManager(
	context: OrganizationSessionRequestContext
): asserts context is OrganizationManagerSessionRequestContext {
	if (!isOrganizationManager(context)) {
		throw new ForbiddenError("Requires organization admin/owner role");
	}
}
