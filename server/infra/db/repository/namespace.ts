import { ulid } from "ulidx";

import type { DatabaseConn } from "..";
import { namespace, namespaceMember } from "../schema/pg";

export type NamespaceRow = typeof namespace.$inferSelect;
export type NamespaceRowInsert = Pick<typeof namespace.$inferInsert, "name" | "organizationId">;
export type NamespaceMemberRowInsert = Pick<typeof namespaceMember.$inferInsert, "userId" | "role">;

export function createNamespaceRepository(db: DatabaseConn) {
	return {
		async createWithMember(
			namespaceParams: NamespaceRowInsert,
			memberParams: NamespaceMemberRowInsert
		): Promise<NamespaceRow> {
			const namespaceId = ulid();
			const memberId = ulid();

			return db.transaction(async (tx) => {
				const [createdNamespace] = await tx
					.insert(namespace)
					.values({ id: namespaceId, ...namespaceParams })
					.returning();

				if (!createdNamespace) {
					// TODO: return 409 on conflict
					throw new Error("Failed to create namespace");
				}

				await tx.insert(namespaceMember).values({ id: memberId, namespaceId, ...memberParams });

				return createdNamespace;
			});
		},
	};
}

export type NamespaceRepository = ReturnType<typeof createNamespaceRepository>;
