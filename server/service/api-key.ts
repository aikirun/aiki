import { randomBytes } from "node:crypto";
import { sha256Sync } from "@aikirun/lib/crypto";
import type { NamespaceId, NamespaceRole } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import type { Redis } from "ioredis";
import type { NonEmptyArray } from "lib/dist/array";
import { UnauthorizedError } from "server/errors";
import type { ApiKeyRepository, ApiKeyRowInsert, Repositories } from "server/infra/db/types";
import type { NamespaceSessionRequestContext } from "server/middleware/context";
import { ulid } from "ulidx";

const PLATFORM = "aiki";
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;
const CACHE_TTL_SECONDS = 4 * 60 * 60;
const CACHE_KEY_PREFIX = `${PLATFORM}:api_key:`;

interface CachedKeyInfo {
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
	expiresAt: number | null;
}

function generateKey(): { key: string; keyPrefix: string } {
	const prefix = randomBytes(PREFIX_LENGTH / 2).toString("hex");
	const secret = randomBytes(SECRET_LENGTH).toString("base64url");
	const key = `${PLATFORM}_${prefix}_${secret}`;
	return { key, keyPrefix: prefix };
}

function isValidKeyFormat(key: string): boolean {
	const firstSeparator = key.indexOf("_");
	if (firstSeparator === -1) {
		return false;
	}

	const secondSeparator = key.indexOf("_", firstSeparator + 1);
	if (secondSeparator === -1) {
		return false;
	}

	const platform = key.slice(0, firstSeparator);
	const prefix = key.slice(firstSeparator + 1, secondSeparator);
	const secret = key.slice(secondSeparator + 1);

	return platform === PLATFORM && prefix.length === PREFIX_LENGTH && secret.length > 0;
}

function getCacheKey(keyHash: string): string {
	return `${CACHE_KEY_PREFIX}${keyHash}`;
}

export interface ApiKeyServiceDeps {
	repos: Pick<Repositories, "apiKey" | "organization" | "namespace">;
	redis?: Redis;
}

export function createApiKeyService({ repos, redis }: ApiKeyServiceDeps) {
	return {
		async resolveNamespaceRole(context: NamespaceSessionRequestContext): Promise<NamespaceRole> {
			const organizationRole = await repos.organization.getMemberRole(context.organizationId, context.userId);
			if (organizationRole === "owner" || organizationRole === "admin") {
				return "admin";
			}
			const namespaceMember = await repos.namespace.getMember(context.namespaceId, context.userId);
			if (!namespaceMember) {
				throw new UnauthorizedError("Not a member of this namespace");
			}
			return namespaceMember.role;
		},

		async create(
			input: Pick<ApiKeyRowInsert, "organizationId" | "namespaceId" | "createdByUserId" | "name" | "expiresAt">
		) {
			const { key, keyPrefix } = generateKey();
			const keyHash = sha256Sync(key);

			const keyInfo = await repos.apiKey.create({
				id: ulid(),
				organizationId: input.organizationId,
				namespaceId: input.namespaceId,
				createdByUserId: input.createdByUserId,
				name: input.name,
				keyHash,
				keyPrefix,
				expiresAt: input.expiresAt,
			});

			return { key, info: keyInfo };
		},

		async verify(key: string) {
			if (!isValidKeyFormat(key)) {
				return null;
			}

			const keyHash = sha256Sync(key);

			if (redis) {
				const cacheKey = getCacheKey(keyHash);
				const cached = await redis.get(cacheKey);
				if (cached) {
					const cachedKeyInfo: CachedKeyInfo = JSON.parse(cached);
					if (cachedKeyInfo.expiresAt && cachedKeyInfo.expiresAt <= Date.now()) {
						return null;
					}

					return {
						namespaceId: cachedKeyInfo.namespaceId,
						organizationId: cachedKeyInfo.organizationId,
					};
				}
			}

			const keyInfo = await repos.apiKey.getByActiveKeyByHash(keyHash);
			if (!keyInfo) {
				return null;
			}
			if (keyInfo.expiresAt && keyInfo.expiresAt <= Date.now()) {
				return null;
			}

			if (redis) {
				const cacheKey = getCacheKey(keyHash);
				const cachedKeyInfo: CachedKeyInfo = {
					organizationId: keyInfo.organizationId as OrganizationId,
					namespaceId: keyInfo.namespaceId as NamespaceId,
					expiresAt: keyInfo.expiresAt,
				};
				await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(cachedKeyInfo));
			}

			return {
				namespaceId: keyInfo.namespaceId,
				organizationId: keyInfo.organizationId,
			};
		},

		async list(filters: { namespaceId: NamespaceId }) {
			return repos.apiKey.list(filters);
		},

		async revoke(id: string): Promise<string | null> {
			return repos.apiKey.revoke(id);
		},

		async revokeByNamespaceId(namespaceId: NamespaceId, txRepo: ApiKeyRepository): Promise<string[]> {
			return txRepo.revokeByNamespace(namespaceId);
		},

		async invalidateCacheByHashes(keyHashes: string | NonEmptyArray<string>): Promise<void> {
			if (redis) {
				if (Array.isArray(keyHashes)) {
					const cacheKeys = keyHashes.map(getCacheKey);
					await redis.del(...cacheKeys);
				} else {
					const cacheKey = getCacheKey(keyHashes);
					await redis.del(cacheKey);
				}
			}
		},
	};
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;
