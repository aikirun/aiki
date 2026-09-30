import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { ScheduleState } from "@aikirun/types/schedule";
import type { WorkflowRunState } from "@aikirun/types/workflow/run";
import type { TaskState } from "@aikirun/types/workflow/task";
import { and, count, eq, inArray, max, sql } from "drizzle-orm";

import {
	toRunOwnedStateTransitionRow,
	toScheduleStateTransitionRow,
	toStateTransitionRow,
} from "../../lib/state-transition-row";
import type { PgDb } from "../provider";
import { stateTransition } from "../schema";

export type StateTransitionRowSelect = typeof stateTransition.$inferSelect;
type _StateTransitionRowInsert = typeof stateTransition.$inferInsert;
type EntityColumn = "type" | "workflowRunId" | "attempt" | "taskId" | "taskSequence" | "scheduleId" | "state";

export type WorkflowRunStateTransitionRow = Omit<StateTransitionRowSelect, EntityColumn> & {
	type: "workflow_run";
	workflowRunId: string;
	attempt: number;
	taskId: null;
	taskSequence: null;
	scheduleId: null;
	state: WorkflowRunState;
};
export type TaskStateTransitionRow = Omit<StateTransitionRowSelect, EntityColumn> & {
	type: "task";
	workflowRunId: string;
	attempt: number;
	taskId: string;
	taskSequence: number;
	scheduleId: null;
	state: TaskState;
};
export type ScheduleStateTransitionRow = Omit<StateTransitionRowSelect, EntityColumn> & {
	type: "schedule";
	workflowRunId: null;
	attempt: null;
	taskId: null;
	taskSequence: null;
	scheduleId: string;
	state: ScheduleState;
};
export type StateTransitionRow = WorkflowRunStateTransitionRow | TaskStateTransitionRow | ScheduleStateTransitionRow;

export type WorkflowRunStateTransitionRowInsert = Omit<_StateTransitionRowInsert, EntityColumn> & {
	type: "workflow_run";
	workflowRunId: string;
	attempt: number;
	state: WorkflowRunState;
};
export type TaskStateTransitionRowInsert = Omit<_StateTransitionRowInsert, EntityColumn> & {
	type: "task";
	workflowRunId: string;
	attempt: number;
	taskId: string;
	taskSequence: number;
	state: TaskState;
};
export type ScheduleStateTransitionRowInsert = Omit<_StateTransitionRowInsert, EntityColumn> & {
	type: "schedule";
	scheduleId: string;
	state: ScheduleState;
};
export type StateTransitionRowInsert =
	| WorkflowRunStateTransitionRowInsert
	| TaskStateTransitionRowInsert
	| ScheduleStateTransitionRowInsert;

export const createStateTransitionRepository = (db: PgDb) => ({
	async append(input: StateTransitionRowInsert): Promise<void> {
		await db.insert(stateTransition).values(input);
	},

	async appendBatch(inputs: NonEmptyArray<StateTransitionRowInsert>): Promise<void> {
		await db.insert(stateTransition).values(inputs);
	},

	async getById(id: string): Promise<StateTransitionRow | null> {
		const result = await db.select().from(stateTransition).where(eq(stateTransition.id, id)).limit(1);
		const row = result[0];
		return row ? toStateTransitionRow(row) : null;
	},

	async getByIds(ids: NonEmptyArray<string>): Promise<StateTransitionRow[]> {
		const rows = await db.select().from(stateTransition).where(inArray(stateTransition.id, ids));
		return rows.map(toStateTransitionRow);
	},

	async getLatestTaskSequence(runId: string, revision: number): Promise<number | null> {
		const result = await db
			.select({ taskSequence: max(stateTransition.taskSequence) })
			.from(stateTransition)
			.where(
				and(
					eq(stateTransition.workflowRunId, runId),
					eq(stateTransition.revision, revision),
					eq(stateTransition.type, "task")
				)
			);
		return result[0]?.taskSequence ?? null;
	},

	async listByRunId(
		runId: string,
		limit = 50,
		offset = 0,
		sort?: { order: "asc" | "desc" }
	): Promise<{ rows: Array<WorkflowRunStateTransitionRow | TaskStateTransitionRow>; total: number }> {
		const sortOrder = sql.raw(sort?.order ?? "desc");

		const [rows, countResult] = await Promise.all([
			db
				.select()
				.from(stateTransition)
				.where(eq(stateTransition.workflowRunId, runId))
				// The type enum declares workflow_run before task, so within one revision the run's
				// transition sorts before the task transitions stamped with the revision it produced,
				// and those sort in the order the worker executing the run numbered them.
				.orderBy(
					sql`${stateTransition.revision} ${sortOrder}`,
					sql`${stateTransition.type} ${sortOrder}`,
					sql`${stateTransition.taskSequence} ${sortOrder}`,
					sql`${stateTransition.id} ${sortOrder}`
				)
				.limit(limit)
				.offset(offset),
			db.select({ count: count() }).from(stateTransition).where(eq(stateTransition.workflowRunId, runId)),
		]);

		return { rows: rows.map(toRunOwnedStateTransitionRow), total: countResult[0]?.count ?? 0 };
	},

	async listByScheduleId(
		scheduleId: string,
		limit = 50,
		offset = 0,
		sort?: { order: "asc" | "desc" }
	): Promise<{ rows: ScheduleStateTransitionRow[]; total: number }> {
		const sortOrder = sql.raw(sort?.order ?? "desc");

		const [rows, countResult] = await Promise.all([
			db
				.select()
				.from(stateTransition)
				.where(eq(stateTransition.scheduleId, scheduleId))
				.orderBy(sql`${stateTransition.revision} ${sortOrder}`, sql`${stateTransition.id} ${sortOrder}`)
				.limit(limit)
				.offset(offset),
			db.select({ count: count() }).from(stateTransition).where(eq(stateTransition.scheduleId, scheduleId)),
		]);

		return { rows: rows.map(toScheduleStateTransitionRow), total: countResult[0]?.count ?? 0 };
	},
});

export type StateTransitionRepository = ReturnType<typeof createStateTransitionRepository>;
