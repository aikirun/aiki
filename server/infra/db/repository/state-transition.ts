import type { NonEmptyArray } from "@aikirun/lib";
import { count, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { stateTransition } from "../schema/pg";

export type StateTransitionRow = typeof stateTransition.$inferSelect;
export type StateTransitionRowInsert = typeof stateTransition.$inferInsert;

export function createStateTransitionRepository(db: DatabaseConn) {
	return {
		async append(input: StateTransitionRowInsert, tx?: DbTransaction): Promise<void> {
			await (tx ?? db).insert(stateTransition).values(input);
		},

		async appendBatch(inputs: NonEmptyArray<StateTransitionRowInsert>, tx?: DbTransaction): Promise<void> {
			await (tx ?? db).insert(stateTransition).values(inputs);
		},

		async appendReturning(input: StateTransitionRowInsert, tx?: DbTransaction): Promise<StateTransitionRow> {
			const result = await (tx ?? db).insert(stateTransition).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create state transition - no row returned");
			}
			return created;
		},

		async getById(id: string, tx?: DbTransaction): Promise<StateTransitionRow | null> {
			const result = await (tx ?? db).select().from(stateTransition).where(eq(stateTransition.id, id)).limit(1);
			return result[0] ?? null;
		},

		async getByIds(ids: NonEmptyArray<string>, tx?: DbTransaction): Promise<StateTransitionRow[]> {
			return (tx ?? db).select().from(stateTransition).where(inArray(stateTransition.id, ids));
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
			const orderBy = sql`${stateTransition.id} ${sortOrder}`;

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

			return { rows, total: countResult[0]?.count ?? 0 };
		},
	};
}

export type StateTransitionRepository = ReturnType<typeof createStateTransitionRepository>;
