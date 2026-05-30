import { eq } from "drizzle-orm";

import type { SqliteDb } from "../provider";
import { childWorkflowRunWaitQueue } from "../schema";

export type ChildWorkflowRunWaitQueueRow = typeof childWorkflowRunWaitQueue.$inferSelect;
export type ChildWorkflowRunWaitQueueRowInsert = typeof childWorkflowRunWaitQueue.$inferInsert;

export function createChildWorkflowRunWaitQueueRepository(db: SqliteDb) {
	return {
		async insert(input: ChildWorkflowRunWaitQueueRowInsert | ChildWorkflowRunWaitQueueRowInsert[]): Promise<void> {
			const values = Array.isArray(input) ? input : [input];
			await db.insert(childWorkflowRunWaitQueue).values(values);
		},

		async listByParentRunId(parentRunId: string): Promise<ChildWorkflowRunWaitQueueRow[]> {
			// TODO: explore loading in chunks
			return db
				.select()
				.from(childWorkflowRunWaitQueue)
				.where(eq(childWorkflowRunWaitQueue.parentWorkflowRunId, parentRunId))
				.orderBy(childWorkflowRunWaitQueue.id)
				.limit(10_000);
		},
	};
}

export type ChildWorkflowRunWaitQueueRepository = ReturnType<typeof createChildWorkflowRunWaitQueueRepository>;
