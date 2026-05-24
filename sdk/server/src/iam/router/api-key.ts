import { fireAndForget } from "@aikirun/lib/async";
import type { NamespaceId } from "@aikirun/types/namespace";

import { organizationAuthedImplementer } from "./implementer";
import { ForbiddenError, NotFoundError } from "../../errors";
import type { OrganizationSessionRequestContext } from "../organization-context";
import type { ApiKeyService } from "../service/api-key";
import type { NamespaceService } from "../service/namespace";

export function createApiKeyRouter(apiKeyService: ApiKeyService, namespaceService: NamespaceService) {
	const os = organizationAuthedImplementer.apiKey;

	async function assertCanManageApiKey(
		context: OrganizationSessionRequestContext,
		namespaceId: NamespaceId
	): Promise<void> {
		const exists = await namespaceService.namespaceExists(context, namespaceId);
		if (!exists) {
			throw new NotFoundError("Namespace not found");
		}

		const role = await namespaceService.resolveRole(context, namespaceId);
		if (role === "admin") {
			return;
		}
		throw new ForbiddenError("Requires organization manager or namespace admin role");
	}

	const createV1 = os.createV1.handler(async ({ input, context }) => {
		const namespaceId = input.namespaceId as NamespaceId;
		await assertCanManageApiKey(context, namespaceId);

		const { key, info } = await apiKeyService.create({
			organizationId: context.organizationId,
			namespaceId,
			createdByUserId: context.userId,
			name: input.name,
			expiresAt: input.expiresAt ?? null,
		});

		return {
			key,
			info: {
				id: info.id,
				name: info.name,
				keyPrefix: info.keyPrefix,
				status: info.status,
				createdAt: info.createdAt,
				expiresAt: info.expiresAt,
			},
		};
	});

	const listV1 = os.listV1.handler(async ({ input, context }) => {
		const namespaceId = input.namespaceId as NamespaceId;
		await assertCanManageApiKey(context, namespaceId);

		const keyInfos = await apiKeyService.list({ organizationId: context.organizationId, namespaceId });
		return { keyInfos };
	});

	const revokeV1 = os.revokeV1.handler(async ({ input, context }) => {
		const namespaceId = input.namespaceId as NamespaceId;
		await assertCanManageApiKey(context, namespaceId);

		const revokedKeyHash = await apiKeyService.revoke({ id: input.id, namespaceId });
		if (revokedKeyHash) {
			fireAndForget(apiKeyService.invalidateCacheByHashes(revokedKeyHash), (_error) => {});
		}
	});

	return os.router({ createV1, listV1, revokeV1 });
}
