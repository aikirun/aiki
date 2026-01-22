import { randomBytes } from "node:crypto";
import { sha256Sync } from "@aikirun/lib/crypto";
import type { Redis } from "ioredis";

import type { ApiKeyRepository, ApiKeyRowInsert } from "../infra/db/repository/api-key";
import { generateUlid } from "../infra/db/ulid";

const PLATFORM = "aiki";
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_KEY_PREFIX = `${PLATFORM}:api_key:`;

interface CachedKeyInfo {
	organizationId: string;
	namespaceId: string;
	expiresAt: number | null;
}

function generateKey(): { key: string; keyPrefix: string } {
	const prefix = randomBytes(PREFIX_LENGTH / 2).toString("hex");
	const secret = randomBytes(SECRET_LENGTH).toString("base64url");
	const key = `${PLATFORM}_${prefix}_${secret}`;
	return { key, keyPrefix: prefix };
}

function isValidKeyFormat(key: string): boolean {
	const parts = key.split("_");
	return parts.length === 3 && parts[0] === PLATFORM;
}

function getCacheKey(keyHash: string): string {
	return `${CACHE_KEY_PREFIX}${keyHash}`;
}

export function createApiKeyService(repo: ApiKeyRepository, redis: Redis) {
	return {
		async create(
			input: Pick<ApiKeyRowInsert, "organizationId" | "namespaceId" | "createdByUserId" | "name" | "expiresAt">
		) {
			const { key, keyPrefix } = generateKey();
			const keyHash = sha256Sync(key);

			const keyInfo = await repo.create({
				id: generateUlid(),
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

			const keyInfo = await repo.getByActiveKeyByHash(keyHash);
			if (!keyInfo) {
				return null;
			}
			if (keyInfo.expiresAt && keyInfo.expiresAt <= Date.now()) {
				return null;
			}

			const cachedKeyInfo: CachedKeyInfo = {
				organizationId: keyInfo.organizationId,
				namespaceId: keyInfo.namespaceId,
				expiresAt: keyInfo.expiresAt,
			};
			await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(cachedKeyInfo));

			return {
				namespaceId: keyInfo.namespaceId,
				organizationId: keyInfo.organizationId,
			};
		},

		async list(filters: { organizationId: string; namespaceId: string }) {
			return repo.list(filters);
		},

		async revoke(id: string) {
			await repo.revoke(id);
		},
	};
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;
