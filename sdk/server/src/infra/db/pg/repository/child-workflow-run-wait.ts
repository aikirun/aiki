import { eq } from "drizzle-orm";

import type { PgDb } from "../provider";
import { childWorkflowRunWait } from "../schema";

export type ChildWorkflowRunWaitRow = typeof childWorkflowRunWait.$inferSelect;
export type ChildWorkflowRunWaitRowInsert = typeof childWorkflowRunWait.$inferInsert;

export const createChildWorkflowRunWaitRepository = (db: PgDb) => ({
	async insert(input: ChildWorkflowRunWaitRowInsert | ChildWorkflowRunWaitRowInsert[]): Promise<void> {
		const values = Array.isArray(input) ? input : [input];
		await db.insert(childWorkflowRunWait).values(values);
	},

	async listByParentRunId(parentRunId: string): Promise<ChildWorkflowRunWaitRow[]> {
		// TODO: explore loading in chunks
		return db
			.select()
			.from(childWorkflowRunWait)
			.where(eq(childWorkflowRunWait.parentWorkflowRunId, parentRunId))
			.orderBy(childWorkflowRunWait.id)
			.limit(10_000);
	},
});

export type ChildWorkflowRunWaitRepository = ReturnType<typeof createChildWorkflowRunWaitRepository>;
