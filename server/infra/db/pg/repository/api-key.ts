import type { NamespaceId } from "@aikirun/types/namespace";
import { and, eq } from "drizzle-orm";

import type { PgDb } from "../provider";
import { apiKey } from "../schema";

export type ApiKeyRow = typeof apiKey.$inferSelect;
export type ApiKeyRowInsert = typeof apiKey.$inferInsert;

export function createApiKeyRepository(db: PgDb) {
	return {
		async create(input: ApiKeyRowInsert): Promise<ApiKeyRow> {
			const result = await db.insert(apiKey).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create API key - no row returned");
			}
			return created;
		},

		async getByActiveKeyByHash(keyHash: string): Promise<ApiKeyRow | null> {
			const result = await db
				.select()
				.from(apiKey)
				.where(and(eq(apiKey.status, "active"), eq(apiKey.keyHash, keyHash)));
			return result[0] ?? null;
		},

		async list(filters: { namespaceId: NamespaceId; createdByUserId?: string; name?: string }) {
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
						eq(apiKey.namespaceId, filters.namespaceId),
						filters.createdByUserId !== undefined ? eq(apiKey.createdByUserId, filters.createdByUserId) : undefined,
						filters.name !== undefined ? eq(apiKey.name, filters.name) : undefined
					)
				);
		},

		async expire(id: string): Promise<void> {
			await db.update(apiKey).set({ status: "expired" }).where(eq(apiKey.id, id));
		},

		async revoke(id: string): Promise<string | null> {
			const rows = await db
				.update(apiKey)
				.set({
					status: "revoked",
					revokedAt: Date.now(),
				})
				.where(eq(apiKey.id, id))
				.returning({ keyHash: apiKey.keyHash });
			return rows[0]?.keyHash ?? null;
		},

		async revokeByNamespace(namespaceId: NamespaceId): Promise<string[]> {
			const rows = await db
				.update(apiKey)
				.set({
					status: "revoked",
					revokedAt: Date.now(),
				})
				.where(and(eq(apiKey.namespaceId, namespaceId), eq(apiKey.status, "active")))
				.returning({ keyHash: apiKey.keyHash });
			return rows.map((row) => row.keyHash);
		},
	};
}

export type ApiKeyRepository = ReturnType<typeof createApiKeyRepository>;
