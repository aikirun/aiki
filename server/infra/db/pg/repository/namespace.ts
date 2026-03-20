import type { NamespaceRole } from "@aikirun/types/namespace";
import { and, eq } from "drizzle-orm";

import type { PgDb } from "../provider";
import { namespace, namespaceMember } from "../schema";

export type NamespaceRow = typeof namespace.$inferSelect;
export type NamespaceRowInsert = Pick<typeof namespace.$inferInsert, "name" | "organizationId">;
export type NamespaceMemberRowInsert = Pick<typeof namespaceMember.$inferInsert, "userId" | "role">;
export type NamespaceMemberRow = typeof namespaceMember.$inferSelect;
export type NamespaceRowWithRole = NamespaceRow & { role: NamespaceRole };

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

		async getMember(namespaceId: string, userId: string): Promise<NamespaceMemberRow | null> {
			const [row] = await db
				.select()
				.from(namespaceMember)
				.where(and(eq(namespaceMember.namespaceId, namespaceId), eq(namespaceMember.userId, userId)))
				.limit(1);
			return row ?? null;
		},

		async listByUser(organizationId: string, userId: string): Promise<NamespaceRowWithRole[]> {
			const rows = await db
				.select({
					id: namespace.id,
					name: namespace.name,
					organizationId: namespace.organizationId,
					status: namespace.status,
					createdAt: namespace.createdAt,
					updatedAt: namespace.updatedAt,
					role: namespaceMember.role,
				})
				.from(namespace)
				.innerJoin(namespaceMember, eq(namespace.id, namespaceMember.namespaceId))
				.where(
					and(
						eq(namespace.organizationId, organizationId),
						eq(namespaceMember.userId, userId),
						eq(namespace.status, "active")
					)
				);
			return rows;
		},

		async listByOrganization(organizationId: string): Promise<NamespaceRow[]> {
			return db
				.select()
				.from(namespace)
				.where(and(eq(namespace.organizationId, organizationId), eq(namespace.status, "active")));
		},

		async softDelete(namespaceId: string): Promise<void> {
			await db.update(namespace).set({ status: "deleted" }).where(eq(namespace.id, namespaceId));
		},

		async countActiveByOrganizationForUpdate(organizationId: string): Promise<number> {
			const rows = await db
				.select({ id: namespace.id })
				.from(namespace)
				.where(and(eq(namespace.organizationId, organizationId), eq(namespace.status, "active")))
				.for("update");
			return rows.length;
		},
	};
}

export type NamespaceRepository = ReturnType<typeof createNamespaceRepository>;
