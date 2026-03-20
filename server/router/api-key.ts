import { fireAndForget } from "@aikirun/lib";
import type { NamespaceRole } from "@aikirun/types/namespace";

import { namespaceAuthedImplementer } from "./implementer";
import { ForbiddenError, UnauthorizedError } from "../errors";
import type { NamespaceRequestContext, NamespaceSessionRequestContext } from "../middleware/context";
import type { ApiKeyService } from "../service/api-key";

export function createApiKeyRouter(apiKeyService: ApiKeyService) {
	const os = namespaceAuthedImplementer.apiKey;

	const createV1 = os.createV1.handler(async ({ input, context }) => {
		assertIsNamespaceSession(context);

		const role = await apiKeyService.resolveNamespaceRole(context);
		assertIsNamespaceAdmin(role);

		const { key, info } = await apiKeyService.create({
			organizationId: context.organizationId,
			namespaceId: context.namespaceId,
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

	const listV1 = os.listV1.handler(async ({ context }) => {
		assertIsNamespaceSession(context);

		const keyInfos = await apiKeyService.list({
			namespaceId: context.namespaceId,
		});

		return { keyInfos };
	});

	const revokeV1 = os.revokeV1.handler(async ({ input, context }) => {
		assertIsNamespaceSession(context);

		const role = await apiKeyService.resolveNamespaceRole(context);
		assertIsNamespaceAdmin(role);

		const revokedKeyHash = await apiKeyService.revoke(input.id);
		if (revokedKeyHash) {
			fireAndForget(apiKeyService.invalidateCacheByHashes(revokedKeyHash), (_error) => {});
		}
	});

	return os.router({ createV1, listV1, revokeV1 });
}

function assertIsNamespaceSession(context: NamespaceRequestContext): asserts context is NamespaceSessionRequestContext {
	if (context.authMethod !== "namespace_session") {
		throw new UnauthorizedError("User not signed in");
	}
}

export function assertIsNamespaceAdmin(role: NamespaceRole): asserts role is "admin" {
	if (role !== "admin") {
		throw new ForbiddenError(`Requires admin role`);
	}
}
