import type { PgDb } from "../provider";
import { namespace, namespaceMember } from "../schema";

export type NamespaceRow = typeof namespace.$inferSelect;
export type NamespaceRowInsert = Pick<typeof namespace.$inferInsert, "name" | "organizationId">;
export type NamespaceMemberRowInsert = Pick<typeof namespaceMember.$inferInsert, "userId" | "role">;

export function createNamespaceRepository(db: PgDb) {
	return {
		async create(namespaceParams: NamespaceRowInsert & { id: string }): Promise<NamespaceRow> {
			const [createdNamespace] = await db.insert(namespace).values(namespaceParams).returning();

			if (!createdNamespace) {
				// TODO: return 409 on conflict
				throw new Error("Failed to create namespace");
			}

			return createdNamespace;
		},

		async createMember(memberParams: NamespaceMemberRowInsert & { id: string; namespaceId: string }): Promise<void> {
			await db.insert(namespaceMember).values(memberParams);
		},
	};
}

export type NamespaceRepository = ReturnType<typeof createNamespaceRepository>;
