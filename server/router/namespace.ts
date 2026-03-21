import { isNonEmptyArray } from "@aikirun/lib";
import type { NamespaceId } from "@aikirun/types/namespace";
import { ForbiddenError } from "server/errors";
import {
	isOrganizationManager,
	type OrganizationManagerSessionRequestContext,
	type OrganizationSessionRequestContext,
} from "server/middleware/context";
import type { NamespaceService } from "server/service/namespace";

import { organizationAuthedImplementer } from "./implementer";

export function createNamespaceRouter(namespaceService: NamespaceService) {
	const os = organizationAuthedImplementer.namespace;

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
		await namespaceService.softDeleteNamespaceId(context, input.id as NamespaceId);
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
		const namespaceRole = await namespaceService.resolveRole(context, input.id as NamespaceId);
		if (namespaceRole !== "admin") {
			throw new ForbiddenError("Requires namespace admin role");
		}
		await namespaceService.setMembership(context, input.id as NamespaceId, input.members);
	});

	const removeMembershipV1 = os.removeMembershipV1.handler(async ({ input, context }) => {
		const namespaceRole = await namespaceService.resolveRole(context, input.id as NamespaceId);
		if (namespaceRole !== "admin") {
			throw new ForbiddenError("Requires namespace admin role");
		}
		await namespaceService.removeMembership(context, input.id as NamespaceId, input.userId);
	});

	const listMembersV1 = os.listMembersV1.handler(async ({ input, context }) => {
		const namespaceRole = await namespaceService.resolveRole(context, input.id as NamespaceId);
		if (namespaceRole !== "admin" && namespaceRole !== "member") {
			throw new ForbiddenError("Requires namespace admin/member role");
		}
		const members = await namespaceService.listMembers(context, input.id as NamespaceId);
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
