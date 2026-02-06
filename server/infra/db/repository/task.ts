import { and, eq, lte } from "drizzle-orm";

import type { DatabaseConn } from "..";
import { task } from "../schema/pg";

type TaskRow = typeof task.$inferSelect;
type TaskRowInsert = typeof task.$inferInsert;
type TaskRowUpdate = Partial<Pick<TaskRowInsert, "status" | "attempts" | "latestStateTransitionId" | "nextAttemptAt">>;

export function createTaskRepository(db: DatabaseConn) {
	return {
		async create(input: TaskRowInsert): Promise<TaskRow> {
			const result = await db.insert(task).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create task - no row returned");
			}
			return created;
		},

		async updateState(id: string, changes: TaskRowUpdate): Promise<TaskRow | null> {
			const result = await db.update(task).set(changes).where(eq(task.id, id)).returning();

			return result[0] ?? null;
		},

		async getById(id: string): Promise<TaskRow | null> {
			const result = await db.select().from(task).where(eq(task.id, id)).limit(1);
			return result[0] ?? null;
		},

		async getByWorkflowRunAndReference(workflowRunId: string, referenceId: string): Promise<TaskRow | null> {
			const result = await db
				.select()
				.from(task)
				.where(and(eq(task.workflowRunId, workflowRunId), eq(task.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},

		async listByWorkflowRunId(workflowRunId: string): Promise<TaskRow[]> {
			return db.select().from(task).where(eq(task.workflowRunId, workflowRunId));
		},

		async listRetryableTasks(before: Date, limit = 100): Promise<TaskRow[]> {
			return db
				.select()
				.from(task)
				.where(and(eq(task.status, "awaiting_retry"), lte(task.nextAttemptAt, before)))
				.limit(limit);
		},
	};
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
