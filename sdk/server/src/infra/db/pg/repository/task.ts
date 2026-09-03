import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { DiscardableTaskStatus, TaskStatus } from "@aikirun/types/workflow/task";
import { and, count, eq, inArray, lte, min, ne, sql } from "drizzle-orm";

import { keysetStreamCursorFilter } from "./lib/keyset-stream";
import { toTaskState } from "./state-transition";
import type { KeysetStreamCursor } from "../../../../lib/keyset-stream";
import type { DaemonContext } from "../../../../middleware/context";
import type { PgDb } from "../provider";
import { stateTransition, task, workflowRun } from "../schema";

export type TaskRow = typeof task.$inferSelect;
type TaskRowInsert = typeof task.$inferInsert;
type TaskRowUpdate = Partial<Pick<TaskRowInsert, "status" | "attempts" | "latestStateTransitionId" | "nextAttemptAt">>;

export const createTaskRepository = (db: PgDb) => ({
	async create(input: TaskRowInsert): Promise<TaskRow> {
		const result = await db.insert(task).values(input).returning();
		const created = result[0];
		if (!created) {
			throw new Error("Failed to create task - no row returned");
		}
		return created;
	},

	async getById(params: { id: string; workflowRunId: string }): Promise<TaskRow | null> {
		const result = await db
			.select()
			.from(task)
			.where(and(eq(task.id, params.id), eq(task.workflowRunId, params.workflowRunId)))
			.limit(1);
		return result[0] ?? null;
	},

	async getByIdWithState(namespaceId: NamespaceId, id: string) {
		const result = await db
			.select({
				id: task.id,
				name: task.name,
				workflowRunId: task.workflowRunId,
				input: task.input,
				inputHash: task.inputHash,
				options: task.options,
				attempts: task.attempts,
				state: stateTransition.state,
			})
			.from(task)
			.innerJoin(workflowRun, eq(task.workflowRunId, workflowRun.id))
			.innerJoin(stateTransition, eq(task.latestStateTransitionId, stateTransition.id))
			.where(and(eq(workflowRun.namespaceId, namespaceId), eq(task.id, id)))
			.limit(1);

		const row = result[0];
		return row ? { ...row, state: toTaskState(row.state) } : null;
	},

	async update(
		filter: { id: string; workflowRunId: string; status: TaskStatus; attempts: number },
		updates: TaskRowUpdate
	): Promise<TaskRow | null> {
		const result = await db
			.update(task)
			.set(updates)
			.where(
				and(
					eq(task.id, filter.id),
					eq(task.workflowRunId, filter.workflowRunId),
					eq(task.status, filter.status),
					eq(task.attempts, filter.attempts)
				)
			)
			.returning();
		return result[0] ?? null;
	},

	async listByWorkflowRunIdWithState(workflowRunId: string) {
		// TODO: explore loading in chunks
		const rows = await db
			.select({
				id: task.id,
				name: task.name,
				inputHash: task.inputHash,
				options: task.options,
				attempts: task.attempts,
				state: stateTransition.state,
			})
			.from(task)
			.innerJoin(stateTransition, eq(task.latestStateTransitionId, stateTransition.id))
			.where(and(eq(task.workflowRunId, workflowRunId), ne(task.status, "discarded")))
			.orderBy(task.id)
			.limit(10_000);

		return rows.map((row) => ({ ...row, state: toTaskState(row.state) }));
	},

	async listRetryableTasks(_context: DaemonContext, before: TimestampMs, limit: number, cursor?: KeysetStreamCursor) {
		const dueAtExpr = min(task.nextAttemptAt);

		return db
			.select({
				workflowRunId: task.workflowRunId,
				dueAt: sql<TimestampMs>`${dueAtExpr}`.mapWith(task.nextAttemptAt),
			})
			.from(task)
			.where(and(eq(task.status, "awaiting_retry"), lte(task.nextAttemptAt, before)))
			.groupBy(task.workflowRunId)
			.having(keysetStreamCursorFilter(dueAtExpr, task.workflowRunId, cursor))
			.orderBy(dueAtExpr, task.workflowRunId)
			.limit(limit);
	},

	async listByWorkflowRunIdsAndStatuses(workflowRunIds: string | NonEmptyArray<string>, statuses: TaskStatus[]) {
		const runIdsFilter =
			typeof workflowRunIds === "string"
				? eq(task.workflowRunId, workflowRunIds)
				: inArray(task.workflowRunId, workflowRunIds);
		return db
			.select({ id: task.id, workflowRunId: task.workflowRunId, attempts: task.attempts, status: task.status })
			.from(task)
			.where(and(runIdsFilter, inArray(task.status, statuses)));
	},

	async countByWorkflowRunIds(workflowRunIds: NonEmptyArray<string>): Promise<Map<string, Record<TaskStatus, number>>> {
		const rows = await db
			.select({
				workflowRunId: task.workflowRunId,
				status: task.status,
				count: count(),
			})
			.from(task)
			.where(inArray(task.workflowRunId, workflowRunIds))
			.groupBy(task.workflowRunId, task.status);

		const result = new Map<string, Record<TaskStatus, number>>();
		for (const row of rows) {
			let taskCounts = result.get(row.workflowRunId);
			if (!taskCounts) {
				taskCounts = { completed: 0, running: 0, failed: 0, awaiting_retry: 0, discarded: 0 };
				result.set(row.workflowRunId, taskCounts);
			}
			taskCounts[row.status] = row.count;
		}
		return result;
	},

	async bulkTransitionToDiscarded(
		tasks: NonEmptyArray<{
			filter: { id: string; workflowRunId: string; status: DiscardableTaskStatus; attempts: number };
			update: { latestStateTransitionId: string };
		}>
	): Promise<string[]> {
		const valueRows = tasks.map(({ filter, update }, index) => {
			if (index === 0) {
				return sql`(${filter.id}::text, ${filter.workflowRunId}::text, ${filter.status}::task_status, ${filter.attempts}::integer, ${update.latestStateTransitionId}::text)`;
			}
			return sql`(${filter.id}, ${filter.workflowRunId}, ${filter.status}, ${filter.attempts}, ${update.latestStateTransitionId})`;
		});

		const result = await db
			.update(task)
			.set({
				status: "discarded",
				nextAttemptAt: null,
				latestStateTransitionId: sql`v.state_transition_id`,
			})
			.from(
				sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, workflow_run_id, status, attempts, state_transition_id)`
			)
			.where(
				sql`${task.id} = v.id AND ${task.workflowRunId} = v.workflow_run_id AND ${task.status} = v.status AND ${task.attempts} = v.attempts`
			)
			.returning({ id: task.id });

		return result.map((row) => row.id);
	},
});

export type TaskRepository = ReturnType<typeof createTaskRepository>;
