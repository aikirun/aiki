import type { NonEmptyArray } from "@aikirun/lib";
import { and, eq, inArray } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { workflowRunOutbox } from "../schema/pg";

export type WorkflowRunOutboxRow = typeof workflowRunOutbox.$inferSelect;
export type WorkflowRunOutboxRowInsert = typeof workflowRunOutbox.$inferInsert;

export function createWorkflowRunOutboxRepository(db: DatabaseConn) {
	return {
		async createBatch(rows: NonEmptyArray<WorkflowRunOutboxRowInsert>, tx?: DbTransaction): Promise<void> {
			await (tx ?? db).insert(workflowRunOutbox).values(rows);
		},

		async listPending(limit = 100, tx?: DbTransaction): Promise<WorkflowRunOutboxRow[]> {
			return (tx ?? db)
				.select()
				.from(workflowRunOutbox)
				.where(eq(workflowRunOutbox.status, "pending"))
				.orderBy(workflowRunOutbox.createdAt)
				.limit(limit);
		},

		async markPublished(ids: NonEmptyArray<string>, tx?: DbTransaction): Promise<void> {
			await (tx ?? db)
				.update(workflowRunOutbox)
				.set({ status: "published" })
				.where(and(eq(workflowRunOutbox.status, "pending"), inArray(workflowRunOutbox.id, ids)));
		},
	};
}

export type WorkflowRunOutboxRepository = ReturnType<typeof createWorkflowRunOutboxRepository>;
