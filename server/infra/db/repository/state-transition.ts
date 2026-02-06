import { and, eq } from "drizzle-orm";

import type { DatabaseConn } from "..";
import { stateTransition } from "../schema/pg";

type StateTransitionRow = typeof stateTransition.$inferSelect;
type StateTransitionRowInsert = typeof stateTransition.$inferInsert;

export function createStateTransitionRepository(db: DatabaseConn) {
	return {
		async append(input: StateTransitionRowInsert): Promise<void> {
			await db.insert(stateTransition).values(input);
		},

		async listByRunId(runId: string): Promise<StateTransitionRow[]> {
			return db
				.select()
				.from(stateTransition)
				.where(eq(stateTransition.workflowRunId, runId))
				.orderBy(stateTransition.id);
		},

		async listByTaskId(workflowRunId: string, taskId: string): Promise<StateTransitionRow[]> {
			return db
				.select()
				.from(stateTransition)
				.where(and(eq(stateTransition.workflowRunId, workflowRunId), eq(stateTransition.taskId, taskId)))
				.orderBy(stateTransition.id);
		},
	};
}

export type StateTransitionRepository = ReturnType<typeof createStateTransitionRepository>;
