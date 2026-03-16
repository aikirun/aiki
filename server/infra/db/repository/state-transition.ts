import type { NonEmptyArray } from "@aikirun/lib";
import type { TaskState } from "@aikirun/types/task";
import type { WorkflowRunState } from "@aikirun/types/workflow-run";
import { count, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { stateTransition } from "../schema/pg";

type _StateTransitionRow = typeof stateTransition.$inferSelect;
export type StateTransitionRow = Omit<_StateTransitionRow, "state"> & {
	state: WorkflowRunState | TaskState;
};
export type StateTransitionRowInsert = typeof stateTransition.$inferInsert;

export function createStateTransitionRepository(db: DatabaseConn) {
	return {
		async append(input: StateTransitionRowInsert, tx?: DbTransaction): Promise<void> {
			await (tx ?? db).insert(stateTransition).values(input);
		},

		async appendBatch(inputs: NonEmptyArray<StateTransitionRowInsert>, tx?: DbTransaction): Promise<void> {
			await (tx ?? db).insert(stateTransition).values(inputs);
		},

		async getById(id: string, tx?: DbTransaction): Promise<StateTransitionRow | null> {
			const result = await (tx ?? db).select().from(stateTransition).where(eq(stateTransition.id, id)).limit(1);
			const row = result[0];
			return row ? normalizeRow(row) : null;
		},

		async getByIds(ids: NonEmptyArray<string>, tx?: DbTransaction): Promise<StateTransitionRow[]> {
			const rows = await (tx ?? db).select().from(stateTransition).where(inArray(stateTransition.id, ids));
			return rows.map(normalizeRow);
		},

		async listByRunId(
			runId: string,
			limit = 50,
			offset = 0,
			sort?: { order: "asc" | "desc" },
			tx?: DbTransaction
		): Promise<{ rows: StateTransitionRow[]; total: number }> {
			const conn = tx ?? db;

			const sortOrder = sort?.order ?? "desc";
			const orderBy = sql`${stateTransition.id} ${sql.raw(sortOrder)}`;

			const [rows, countResult] = await Promise.all([
				conn
					.select()
					.from(stateTransition)
					.where(eq(stateTransition.workflowRunId, runId))
					.orderBy(orderBy)
					.limit(limit)
					.offset(offset),
				conn.select({ count: count() }).from(stateTransition).where(eq(stateTransition.workflowRunId, runId)),
			]);

			return { rows: rows.map(normalizeRow), total: countResult[0]?.count ?? 0 };
		},
	};
}

export type StateTransitionRepository = ReturnType<typeof createStateTransitionRepository>;

/**
 * JSONB cannot represent `undefined` — keys with `undefined` values are dropped on insert.
 * These functions restore missing keys when reading JSONB data back from the database,
 * ensuring the returned objects conform to their domain types.
 */

export function toWorkflowRunState(raw: unknown): WorkflowRunState {
	const state = raw as Record<string, unknown>;
	if (state.status === "completed" && !("output" in state)) {
		state.output = undefined;
	}
	return state as unknown as WorkflowRunState;
}

export function toTaskState(raw: unknown): TaskState {
	const state = raw as Record<string, unknown>;
	if (state.status === "running" && !("input" in state)) {
		state.input = undefined;
	}
	if (state.status === "completed" && !("output" in state)) {
		state.output = undefined;
	}
	return state as unknown as TaskState;
}

function normalizeRow(row: _StateTransitionRow): StateTransitionRow {
	(row as Record<string, unknown>).state = row.type === "task" ? toTaskState(row.state) : toWorkflowRunState(row.state);
	return row as unknown as StateTransitionRow;
}
