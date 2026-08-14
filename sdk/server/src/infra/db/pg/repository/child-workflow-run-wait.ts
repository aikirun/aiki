import { eq, getTableColumns } from "drizzle-orm";

import { toWorkflowRunState } from "./state-transition";
import type { PgDb } from "../provider";
import { childWorkflowRunWait, stateTransition } from "../schema";

export type ChildWorkflowRunWaitRow = typeof childWorkflowRunWait.$inferSelect;
export type ChildWorkflowRunWaitRowInsert = typeof childWorkflowRunWait.$inferInsert;

export const createChildWorkflowRunWaitRepository = (db: PgDb) => ({
	async insert(input: ChildWorkflowRunWaitRowInsert | ChildWorkflowRunWaitRowInsert[]): Promise<void> {
		const values = Array.isArray(input) ? input : [input];
		await db.insert(childWorkflowRunWait).values(values);
	},

	async listByParentRunIdWithChildState(parentRunId: string) {
		// TODO: explore loading in chunks
		const rows = await db
			.select({
				...getTableColumns(childWorkflowRunWait),
				childWorkflowRunState: stateTransition.state,
			})
			.from(childWorkflowRunWait)
			.leftJoin(stateTransition, eq(childWorkflowRunWait.childWorkflowRunStateTransitionId, stateTransition.id))
			.where(eq(childWorkflowRunWait.parentWorkflowRunId, parentRunId))
			.orderBy(childWorkflowRunWait.id)
			.limit(10_000);

		return rows.map((row) => ({
			...row,
			childWorkflowRunState: row.childWorkflowRunState !== null ? toWorkflowRunState(row.childWorkflowRunState) : null,
		}));
	},
});

export type ChildWorkflowRunWaitRepository = ReturnType<typeof createChildWorkflowRunWaitRepository>;
