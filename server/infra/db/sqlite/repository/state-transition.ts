import type { NonEmptyArray } from "@aikirun/lib";
import type { TaskState } from "@aikirun/types/task";
import type { WorkflowRunState } from "@aikirun/types/workflow-run";
import { count, eq, inArray, sql } from "drizzle-orm";

import { toTaskState, toWorkflowRunState } from "../../pg/repository/state-transition";
import type { SqliteDb } from "../provider";
import { stateTransition } from "../schema";

type _StateTransitionRow = typeof stateTransition.$inferSelect;
export type StateTransitionRow = Omit<_StateTransitionRow, "state"> & {
	state: WorkflowRunState | TaskState;
};
export type StateTransitionRowInsert = typeof stateTransition.$inferInsert;

export function createStateTransitionRepository(db: SqliteDb) {
	return {
		async append(input: StateTransitionRowInsert): Promise<void> {
			await db.insert(stateTransition).values(input);
		},

		async appendBatch(inputs: NonEmptyArray<StateTransitionRowInsert>): Promise<void> {
			await db.insert(stateTransition).values(inputs);
		},

		async getById(id: string): Promise<StateTransitionRow | null> {
			const result = await db.select().from(stateTransition).where(eq(stateTransition.id, id)).limit(1);
			const row = result[0];
			return row ? normalizeRow(row) : null;
		},

		async getByIds(ids: NonEmptyArray<string>): Promise<StateTransitionRow[]> {
			const rows = await db.select().from(stateTransition).where(inArray(stateTransition.id, ids));
			return rows.map(normalizeRow);
		},

		async listByRunId(
			runId: string,
			limit = 50,
			offset = 0,
			sort?: { order: "asc" | "desc" }
		): Promise<{ rows: StateTransitionRow[]; total: number }> {
			const sortOrder = sort?.order ?? "desc";
			const orderBy = sql`${stateTransition.id} ${sql.raw(sortOrder)}`;

			const [rows, countResult] = await Promise.all([
				db
					.select()
					.from(stateTransition)
					.where(eq(stateTransition.workflowRunId, runId))
					.orderBy(orderBy)
					.limit(limit)
					.offset(offset),
				db.select({ count: count() }).from(stateTransition).where(eq(stateTransition.workflowRunId, runId)),
			]);

			return { rows: rows.map(normalizeRow), total: countResult[0]?.count ?? 0 };
		},
	};
}

export type StateTransitionRepository = ReturnType<typeof createStateTransitionRepository>;

function normalizeRow(row: _StateTransitionRow): StateTransitionRow {
	(row as Record<string, unknown>).state = row.type === "task" ? toTaskState(row.state) : toWorkflowRunState(row.state);
	return row as unknown as StateTransitionRow;
}
