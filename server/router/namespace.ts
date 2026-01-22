import type { NamespaceService } from "server/service/namespace";

import { organizationAuthedImplementer } from "./implementer";

export function createNamespaceRouter(namespaceService: NamespaceService) {
	const os = organizationAuthedImplementer.namespace;

	const createV1 = os.createV1.handler(async ({ input, context }) => {
		const createdNamespace = await namespaceService.createNamespaceWithMember({
			name: input.name,
			organizationId: context.organizationId,
			userId: context.userId,
		});

		return { namespace: createdNamespace };
	});

	return os.router({
		createV1,
	});
}
