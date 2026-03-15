import type { NonEmptyArray } from "@aikirun/lib";
import { and, eq, inArray, lte, min } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { task } from "../schema/pg";

export type TaskRow = typeof task.$inferSelect;
type TaskRowInsert = typeof task.$inferInsert;
type TaskRowUpdate = Partial<Pick<TaskRowInsert, "status" | "attempts" | "latestStateTransitionId" | "nextAttemptAt">>;

export function createTaskRepository(db: DatabaseConn) {
	return {
		async create(input: TaskRowInsert, tx?: DbTransaction): Promise<TaskRow> {
			const result = await (tx ?? db).insert(task).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create task - no row returned");
			}
			return created;
		},

		async getById(id: string, tx?: DbTransaction): Promise<TaskRow | null> {
			const result = await (tx ?? db).select().from(task).where(eq(task.id, id)).limit(1);
			return result[0] ?? null;
		},

		async update(id: string, updates: TaskRowUpdate, tx?: DbTransaction): Promise<TaskRow | null> {
			const result = await (tx ?? db).update(task).set(updates).where(eq(task.id, id)).returning();
			return result[0] ?? null;
		},

		async listByWorkflowRunId(workflowRunId: string, tx?: DbTransaction): Promise<TaskRow[]> {
			// TODO: explore loading in chunks
			return (tx ?? db).select().from(task).where(eq(task.workflowRunId, workflowRunId)).orderBy(task.id).limit(10_000);
		},

		async listRetryableTaskWorkflowRunIds(limit = 100, tx?: DbTransaction): Promise<string[]> {
			const rows = await (tx ?? db)
				.select({ workflowRunId: task.workflowRunId })
				.from(task)
				.where(and(eq(task.status, "awaiting_retry"), lte(task.nextAttemptAt, new Date())))
				.groupBy(task.workflowRunId)
				.orderBy(min(task.nextAttemptAt))
				.limit(limit);
			return rows.map((row) => row.workflowRunId);
		},

		async deleteStaleByWorkflowRunIds(
			workflowRunIds: string | NonEmptyArray<string>,
			tx?: DbTransaction
		): Promise<void> {
			const runIdsFilter =
				typeof workflowRunIds === "string"
					? eq(task.workflowRunId, workflowRunIds)
					: inArray(task.workflowRunId, workflowRunIds);
			await (tx ?? db)
				.delete(task)
				.where(and(runIdsFilter, inArray(task.status, ["running", "awaiting_retry", "failed"])));
		},
	};
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
