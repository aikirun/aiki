import { and, eq, like } from "drizzle-orm";

import type { DatabaseConn } from "..";
import { workflow } from "../schema/pg";

type WorkflowRow = typeof workflow.$inferSelect;
type WorkflowRowInsert = typeof workflow.$inferInsert;

export function createWorkflowRepository(db: DatabaseConn) {
	return {
		async create(input: WorkflowRowInsert): Promise<WorkflowRow> {
			const result = await db.insert(workflow).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create workflow - no row returned");
			}
			return created;
		},

		async getById(namespaceId: string, id: string): Promise<WorkflowRow | null> {
			const result = await db
				.select()
				.from(workflow)
				.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.id, id)))
				.limit(1);
			return result[0] ?? null;
		},

		async listByNamePrefixAndVersion(
			namespaceId: string,
			namePrefix: string,
			version?: string
		): Promise<WorkflowRow[]> {
			return db
				.select()
				.from(workflow)
				.where(
					and(
						eq(workflow.namespaceId, namespaceId),
						like(workflow.name, `${namePrefix}%`),
						version !== undefined ? eq(workflow.version, version) : undefined
					)
				);
		},
	};
}

export type WorkflowRepository = ReturnType<typeof createWorkflowRepository>;
