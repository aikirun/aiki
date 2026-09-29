import { and, eq } from "drizzle-orm";

import type { OrganizationRepository } from "../../types/organization";
import type { SqliteDb } from "../provider";
import { organizationMember } from "../schema";

export const createOrganizationRepository = (db: SqliteDb): OrganizationRepository => ({
	async getMemberRole(organizationId, userId) {
		const [row] = await db
			.select({ role: organizationMember.role })
			.from(organizationMember)
			.where(and(eq(organizationMember.organizationId, organizationId), eq(organizationMember.userId, userId)))
			.limit(1);
		return row?.role ?? null;
	},
});
