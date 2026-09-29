import type { TimestampMs } from "@aikirun/lib/timestamp";
import { and, eq } from "drizzle-orm";

import type { ApiKeyRepository } from "../../types/api-key";
import type { SqliteDb } from "../provider";
import { apiKey } from "../schema";

export const createApiKeyRepository = (db: SqliteDb): ApiKeyRepository => ({
	async create(input) {
		const result = await db.insert(apiKey).values(input).returning();
		const created = result[0];
		if (!created) {
			throw new Error("Failed to create API key - no row returned");
		}
		return created;
	},

	async getByActiveKeyByHash(keyHash) {
		const result = await db
			.select()
			.from(apiKey)
			.where(and(eq(apiKey.status, "active"), eq(apiKey.keyHash, keyHash)));
		return result[0] ?? null;
	},

	async list(filter) {
		return db
			.select({
				id: apiKey.id,
				name: apiKey.name,
				keyPrefix: apiKey.keyPrefix,
				status: apiKey.status,
				createdAt: apiKey.createdAt,
				expiresAt: apiKey.expiresAt,
			})
			.from(apiKey)
			.where(
				and(
					eq(apiKey.organizationId, filter.organizationId),
					eq(apiKey.namespaceId, filter.namespaceId),
					filter.createdByUserId !== undefined ? eq(apiKey.createdByUserId, filter.createdByUserId) : undefined,
					filter.name !== undefined ? eq(apiKey.name, filter.name) : undefined
				)
			);
	},

	async expire(id) {
		await db.update(apiKey).set({ status: "expired" }).where(eq(apiKey.id, id));
	},

	async revoke(filter) {
		const rows = await db
			.update(apiKey)
			.set({
				status: "revoked",
				revokedAt: Date.now() as TimestampMs,
			})
			.where(and(eq(apiKey.id, filter.id), eq(apiKey.namespaceId, filter.namespaceId)))
			.returning({ keyHash: apiKey.keyHash });
		return rows[0]?.keyHash ?? null;
	},

	async revokeByNamespace(namespaceId) {
		const rows = await db
			.update(apiKey)
			.set({
				status: "revoked",
				revokedAt: Date.now() as TimestampMs,
			})
			.where(and(eq(apiKey.namespaceId, namespaceId), eq(apiKey.status, "active")))
			.returning({ keyHash: apiKey.keyHash });
		return rows.map((row) => row.keyHash);
	},
});
