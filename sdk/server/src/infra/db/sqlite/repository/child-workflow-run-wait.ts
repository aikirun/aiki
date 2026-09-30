import { eq, getTableColumns } from "drizzle-orm";

import { toWorkflowRunState } from "../../lib/state-transition-row";
import type {
	ChildWorkflowRunWaitRepository,
	ChildWorkflowRunWaitRowInsert,
} from "../../types/child-workflow-run-wait";
import type { SqliteDb } from "../provider";
import { childWorkflowRunWait, stateTransition } from "../schema";

export const createChildWorkflowRunWaitRepository = (db: SqliteDb): ChildWorkflowRunWaitRepository => ({
	async insert(input: ChildWorkflowRunWaitRowInsert | ChildWorkflowRunWaitRowInsert[]): Promise<void> {
		const values = Array.isArray(input) ? input : [input];
		await db.insert(childWorkflowRunWait).values(values);
	},

	async listByParentRunIdWithChildState(parentRunId) {
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
