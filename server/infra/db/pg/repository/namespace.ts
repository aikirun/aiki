import type { NonEmptyArray } from "@aikirun/lib/array";
import type { NamespaceRole } from "@aikirun/types/namespace";
import type { NamespaceMemberInfo, NamespaceMemberInput } from "@aikirun/types/namespace-api";
import { and, eq, sql } from "drizzle-orm";
import { ConflictError } from "server/errors";
import { ulid } from "ulidx";

import type { PgDb } from "../provider";
import { namespace, namespaceMember, user } from "../schema";

export type NamespaceRow = typeof namespace.$inferSelect;
export type NamespaceRowInsert = Pick<typeof namespace.$inferInsert, "name" | "organizationId">;
export type NamespaceMemberRowInsert = Pick<typeof namespaceMember.$inferInsert, "userId" | "role">;
export type NamespaceMemberRow = typeof namespaceMember.$inferSelect;
export type NamespaceRowWithRole = NamespaceRow & { role: NamespaceRole };

export function createNamespaceRepository(db: PgDb) {
	return {
		async create(namespaceParams: NamespaceRowInsert): Promise<NamespaceRow> {
			const [createdNamespace] = await db
				.insert(namespace)
				.values({ ...namespaceParams, id: ulid() })
				.onConflictDoUpdate({
					target: [namespace.organizationId, namespace.name],
					set: { status: "active" },
					where: eq(namespace.status, "deleted"),
				})
				.returning();
			if (!createdNamespace) {
				throw new ConflictError(`Namespace with name "${namespaceParams.name}" already exists`);
			}

			return createdNamespace;
		},

		async createMember(memberParams: NamespaceMemberRowInsert & { id: string; namespaceId: string }): Promise<void> {
			await db
				.insert(namespaceMember)
				.values(memberParams)
				.onConflictDoUpdate({
					target: [namespaceMember.namespaceId, namespaceMember.userId],
					set: { role: memberParams.role },
				});
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

		async upsertMembers(namespaceId: string, members: NonEmptyArray<NamespaceMemberInput>): Promise<void> {
			await db
				.insert(namespaceMember)
				.values(
					members.map((m) => ({
						id: ulid(),
						namespaceId,
						userId: m.userId,
						role: m.role,
					}))
				)
				.onConflictDoUpdate({
					target: [namespaceMember.namespaceId, namespaceMember.userId],
					set: { role: sql`excluded.role` },
				});
		},

		async removeMember(namespaceId: string, userId: string): Promise<void> {
			await db
				.delete(namespaceMember)
				.where(and(eq(namespaceMember.namespaceId, namespaceId), eq(namespaceMember.userId, userId)));
		},

		async listMembers(namespaceId: string): Promise<NamespaceMemberInfo[]> {
			const rows = await db
				.select({
					userId: namespaceMember.userId,
					name: user.name,
					email: user.email,
					role: namespaceMember.role,
				})
				.from(namespaceMember)
				.innerJoin(user, eq(namespaceMember.userId, user.id))
				.where(eq(namespaceMember.namespaceId, namespaceId));
			return rows.map((row) => ({
				userId: row.userId,
				name: row.name ?? undefined,
				email: row.email,
				role: row.role,
			}));
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
