import { and, eq } from "drizzle-orm";

import type { SqliteDb } from "../provider";
import { organizationMember } from "../schema";

export function createOrganizationRepository(db: SqliteDb) {
	return {
		async getMemberRole(organizationId: string, userId: string) {
			const [row] = await db
				.select({ role: organizationMember.role })
				.from(organizationMember)
				.where(and(eq(organizationMember.organizationId, organizationId), eq(organizationMember.userId, userId)))
				.limit(1);
			return row?.role ?? null;
		},
	};
}

export type OrganizationRepository = ReturnType<typeof createOrganizationRepository>;
