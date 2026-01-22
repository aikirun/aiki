import { namespaceAuthedImplementer } from "./implementer";
import { UnauthorizedError } from "../errors";
import type { ApiKeyService } from "../service/api-key";

export function createApiKeyRouter(apiKeyService: ApiKeyService) {
	const os = namespaceAuthedImplementer.apiKey;

	const createV1 = os.createV1.handler(async ({ input, context }) => {
		if (context.authMethod !== "namespace_session") {
			throw new UnauthorizedError("User not signed in");
		}

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
		if (context.authMethod !== "namespace_session") {
			throw new UnauthorizedError("User not signed in");
		}

		const keyInfos = await apiKeyService.list({
			organizationId: context.organizationId,
			namespaceId: context.namespaceId,
		});

		return { keyInfos };
	});

	const revokeV1 = os.revokeV1.handler(async ({ input, context }) => {
		if (context.authMethod !== "namespace_session") {
			throw new UnauthorizedError("User not signed in");
		}

		await apiKeyService.revoke(input.id);
	});

	return os.router({ createV1, listV1, revokeV1 });
}
