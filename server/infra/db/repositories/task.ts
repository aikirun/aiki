import { and, eq, lte, sql } from "drizzle-orm";

import type { Database } from "..";
import { task, taskStateTransition } from "../schema/pg";

type TaskRow = typeof task.$inferSelect;
type TaskRowInsert = typeof task.$inferInsert;
type TaskRowUpdate = Partial<Pick<TaskRowInsert, "status" | "attempts" | "latestStateTransitionId" | "nextAttemptAt">>;

export interface TaskRepository {
	create(input: TaskRowInsert): Promise<TaskRow>;
	updateState(id: string, revision: number, changes: TaskRowUpdate): Promise<TaskRow | null>;
	getById(id: string): Promise<TaskRow | null>;
	getByWorkflowRunAndReference(workflowRunId: string, referenceId: string): Promise<TaskRow | null>;
	listByWorkflowRunId(workflowRunId: string): Promise<TaskRow[]>;
	listRetryableTasks(before: Date, limit?: number): Promise<TaskRow[]>;
}

export function createTaskRepository(db: Database): TaskRepository {
	return {
		async create(input: TaskRowInsert): Promise<TaskRow> {
			const result = await db.insert(task).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create task - no row returned");
			}
			return created;
		},

		async updateState(id: string, revision: number, changes: TaskRowUpdate): Promise<TaskRow | null> {
			const result = await db
				.update(task)
				.set({
					...changes,
					revision: sql`${task.revision} + 1`,
				})
				.where(and(eq(task.id, id), eq(task.revision, revision)))
				.returning();

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

type TaskStateTransitionRow = typeof taskStateTransition.$inferSelect;
type TaskStateTransitionRowInsert = typeof taskStateTransition.$inferInsert;

export interface TaskStateTransitionRepository {
	append(input: TaskStateTransitionRowInsert): Promise<void>;
	listByTaskId(taskId: string): Promise<TaskStateTransitionRow[]>;
}

export function createTaskStateTransitionRepository(db: Database): TaskStateTransitionRepository {
	return {
		async append(input: TaskStateTransitionRowInsert): Promise<void> {
			await db.insert(taskStateTransition).values(input);
		},

		async listByTaskId(taskId: string): Promise<TaskStateTransitionRow[]> {
			return db
				.select()
				.from(taskStateTransition)
				.where(eq(taskStateTransition.taskId, taskId))
				.orderBy(taskStateTransition.createdAt);
		},
	};
}
