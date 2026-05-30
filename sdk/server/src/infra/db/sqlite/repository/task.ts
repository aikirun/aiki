import type { NonEmptyArray } from "@aikirun/lib/array";
import type { TaskStatus } from "@aikirun/types/workflow/task";
import { and, eq, inArray, lte, min, ne, sql } from "drizzle-orm";

import { timerStreamCursorFilter } from "./lib/timer-stream";
import type { TimerStreamCursor } from "../../../../lib/timer-stream";
import type { DaemonContext } from "../../../../middleware/context";
import type { SqliteDb } from "../provider";
import { task } from "../schema";

export type TaskRow = typeof task.$inferSelect;
type TaskRowInsert = typeof task.$inferInsert;
type TaskRowUpdate = Partial<Pick<TaskRowInsert, "status" | "attempts" | "latestStateTransitionId" | "nextAttemptAt">>;

export function createTaskRepository(db: SqliteDb) {
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
			return db
				.select()
				.from(task)
				.where(and(eq(task.workflowRunId, workflowRunId), ne(task.status, "discarded")))
				.orderBy(task.id)
				.limit(10_000);
		},

		async listRetryableTaskWorkflowRuns(
			_context: DaemonContext,
			before: Date,
			limit: number,
			cursor?: TimerStreamCursor
		) {
			const dueAtExpr = min(task.nextAttemptAt);

			return db
				.select({
					workflowRunId: task.workflowRunId,
					dueAt: sql<Date>`${dueAtExpr}`.mapWith(task.nextAttemptAt),
				})
				.from(task)
				.where(and(eq(task.status, "awaiting_retry"), lte(task.nextAttemptAt, before)))
				.groupBy(task.workflowRunId)
				.having(timerStreamCursorFilter(dueAtExpr, task.workflowRunId, cursor))
				.orderBy(dueAtExpr, task.workflowRunId)
				.limit(limit);
		},

		async listByWorkflowRunIdsAndStatuses(
			workflowRunIds: string | NonEmptyArray<string>,
			statuses: TaskStatus[]
		): Promise<Array<Pick<TaskRow, "id" | "workflowRunId" | "attempts">>> {
			const runIdsFilter =
				typeof workflowRunIds === "string"
					? eq(task.workflowRunId, workflowRunIds)
					: inArray(task.workflowRunId, workflowRunIds);
			return db
				.select({ id: task.id, workflowRunId: task.workflowRunId, attempts: task.attempts })
				.from(task)
				.where(and(runIdsFilter, inArray(task.status, statuses)));
		},

		async bulkDiscard(
			tasks: NonEmptyArray<{ filter: { id: string }; update: { latestStateTransitionId: string } }>
		): Promise<void> {
			// SQLite has no UPDATE ... FROM (VALUES ...); drive the per-row update with CASE.
			const ids = tasks.map(({ filter }) => filter.id);
			const caseFragments = tasks.map(
				({ filter, update }) => sql`WHEN ${filter.id} THEN ${update.latestStateTransitionId}`
			);

			await db
				.update(task)
				.set({
					status: "discarded",
					nextAttemptAt: null,
					latestStateTransitionId: sql`CASE ${task.id} ${sql.join(caseFragments, sql` `)} END`,
				})
				.where(inArray(task.id, ids));
		},
	};
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
