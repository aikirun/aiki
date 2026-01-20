import { and, eq } from "drizzle-orm";

import type { DatabaseConn } from "..";
import { apiKey } from "../schema/pg";

export type ApiKeyRow = typeof apiKey.$inferSelect;
export type ApiKeyRowInsert = typeof apiKey.$inferInsert;

export function createApiKeyRepository(db: DatabaseConn) {
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

		async list(filters: {
			organizationId: string;
			namespaceId: string;
			createdByUserId?: string;
			name?: string;
		}): Promise<ApiKeyRow[]> {
			return db
				.select()
				.from(apiKey)
				.where(
					and(
						eq(apiKey.organizationId, filters.organizationId),
						eq(apiKey.namespaceId, filters.namespaceId),
						filters.createdByUserId !== undefined ? eq(apiKey.createdByUserId, filters.createdByUserId) : undefined,
						filters.name !== undefined ? eq(apiKey.name, filters.name) : undefined
					)
				);
		},

		async expire(id: string): Promise<void> {
			await db.update(apiKey).set({ status: "expired" }).where(eq(apiKey.id, id));
		},

		async revoke(id: string): Promise<void> {
			await db
				.update(apiKey)
				.set({
					status: "revoked",
					revokedAt: new Date(),
				})
				.where(eq(apiKey.id, id));
		},
	};
}

export type ApiKeyRepository = ReturnType<typeof createApiKeyRepository>;
