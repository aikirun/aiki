import { eq } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { childWorkflowRunWaitQueue } from "../schema/pg";

export type ChildWorkflowRunWaitQueueRow = typeof childWorkflowRunWaitQueue.$inferSelect;
export type ChildWorkflowRunWaitQueueRowInsert = typeof childWorkflowRunWaitQueue.$inferInsert;

export function createChildWorkflowRunWaitQueueRepository(db: DatabaseConn) {
	return {
		async insert(
			input: ChildWorkflowRunWaitQueueRowInsert | ChildWorkflowRunWaitQueueRowInsert[],
			tx?: DbTransaction
		): Promise<void> {
			const values = Array.isArray(input) ? input : [input];
			await (tx ?? db).insert(childWorkflowRunWaitQueue).values(values);
		},

		async listByParentRunId(parentRunId: string, tx?: DbTransaction): Promise<ChildWorkflowRunWaitQueueRow[]> {
			// TODO: explore loading in chunks
			return (tx ?? db)
				.select()
				.from(childWorkflowRunWaitQueue)
				.where(eq(childWorkflowRunWaitQueue.parentWorkflowRunId, parentRunId))
				.orderBy(childWorkflowRunWaitQueue.id)
				.limit(10_000);
		},
	};
}

export type ChildWorkflowRunWaitQueueRepository = ReturnType<typeof createChildWorkflowRunWaitQueueRepository>;
