import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import { and, eq } from "drizzle-orm";

import type { PgDb } from "../provider";
import { apiKey } from "../schema/auth";

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

		async list(filter: {
			organizationId: OrganizationId;
			namespaceId: NamespaceId;
			createdByUserId?: string;
			name?: string;
		}) {
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

		async expire(id: string): Promise<void> {
			await db.update(apiKey).set({ status: "expired" }).where(eq(apiKey.id, id));
		},

		async revoke(filter: { id: string; namespaceId: NamespaceId }): Promise<string | null> {
			const rows = await db
				.update(apiKey)
				.set({
					status: "revoked",
					revokedAt: Date.now(),
				})
				.where(and(eq(apiKey.id, filter.id), eq(apiKey.namespaceId, filter.namespaceId)))
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
