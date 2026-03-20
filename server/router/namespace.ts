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
		const namespaces = await namespaceService.listNamespacesForUser(context);
		return { namespaces };
	});

	const deleteV1 = os.deleteV1.handler(async ({ input, context }) => {
		assertIsOrganizationManager(context);
		await namespaceService.softDeleteNamespaceId(context, input.id as NamespaceId);
	});

	return os.router({
		createV1,
		listV1,
		deleteV1,
	});
}

function assertIsOrganizationManager(
	context: OrganizationSessionRequestContext
): asserts context is OrganizationManagerSessionRequestContext {
	if (!isOrganizationManager(context)) {
		throw new ForbiddenError("Requires organization admin/owner role");
	}
}
