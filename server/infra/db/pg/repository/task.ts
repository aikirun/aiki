import type { NonEmptyArray } from "@aikirun/lib/array";
import { and, eq, inArray, lte, min, sql } from "drizzle-orm";
import type { TimerStreamCursor } from "server/crons/lib/timer-stream";
import type { CronContext } from "server/middleware/context";

import { timerStreamCursorFilter } from "./lib/timer-stream";
import type { PgDb } from "../provider";
import { task } from "../schema";

export type TaskRow = typeof task.$inferSelect;
type TaskRowInsert = typeof task.$inferInsert;
type TaskRowUpdate = Partial<Pick<TaskRowInsert, "status" | "attempts" | "latestStateTransitionId" | "nextAttemptAt">>;

export function createTaskRepository(db: PgDb) {
	return {
		async create(input: TaskRowInsert): Promise<TaskRow> {
			const result = await db.insert(task).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create task - no row returned");
			}
			return created;
		},

		async getById(id: string): Promise<TaskRow | null> {
			const result = await db.select().from(task).where(eq(task.id, id)).limit(1);
			return result[0] ?? null;
		},

		async update(id: string, updates: TaskRowUpdate): Promise<TaskRow | null> {
			const result = await db.update(task).set(updates).where(eq(task.id, id)).returning();
			return result[0] ?? null;
		},

		async listByWorkflowRunId(workflowRunId: string): Promise<TaskRow[]> {
			// TODO: explore loading in chunks
			return db.select().from(task).where(eq(task.workflowRunId, workflowRunId)).orderBy(task.id).limit(10_000);
		},

		async listRetryableTaskWorkflowRuns(
			_context: CronContext,
			before: Date,
			limit: number,
			cursor?: TimerStreamCursor
		) {
			const dueAtExpr = min(task.nextAttemptAt);

			return db
				.select({
					workflowRunId: task.workflowRunId,
					dueAt: sql<Date>`${dueAtExpr}`,
				})
				.from(task)
				.where(and(eq(task.status, "awaiting_retry"), lte(task.nextAttemptAt, before)))
				.groupBy(task.workflowRunId)
				.having(timerStreamCursorFilter(dueAtExpr, task.workflowRunId, cursor))
				.orderBy(dueAtExpr, task.workflowRunId)
				.limit(limit);
		},

		async deleteStaleByWorkflowRunIds(workflowRunIds: string | NonEmptyArray<string>): Promise<void> {
			const runIdsFilter =
				typeof workflowRunIds === "string"
					? eq(task.workflowRunId, workflowRunIds)
					: inArray(task.workflowRunId, workflowRunIds);
			await db.delete(task).where(and(runIdsFilter, inArray(task.status, ["running", "awaiting_retry", "failed"])));
		},
	};
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
