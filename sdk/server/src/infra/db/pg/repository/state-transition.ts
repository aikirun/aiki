import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { ScheduleState } from "@aikirun/types/schedule";
import { TERMINAL_WORKFLOW_RUN_STATUSES, type WorkflowRunState } from "@aikirun/types/workflow/run";
import type { TaskState } from "@aikirun/types/workflow/task";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";

import type { PgDb } from "../provider";
import { stateTransition, workflowRun } from "../schema";

type _StateTransitionRow = typeof stateTransition.$inferSelect;
type _StateTransitionRowInsert = typeof stateTransition.$inferInsert;
type EntityColumn = "type" | "workflowRunId" | "attempt" | "taskId" | "scheduleId" | "state";

export type WorkflowRunStateTransitionRow = Omit<_StateTransitionRow, EntityColumn> & {
	type: "workflow_run";
	workflowRunId: string;
	attempt: number;
	taskId: null;
	scheduleId: null;
	state: WorkflowRunState;
};
export type TaskStateTransitionRow = Omit<_StateTransitionRow, EntityColumn> & {
	type: "task";
	workflowRunId: string;
	attempt: number;
	taskId: string;
	scheduleId: null;
	state: TaskState;
};
export type ScheduleStateTransitionRow = Omit<_StateTransitionRow, EntityColumn> & {
	type: "schedule";
	workflowRunId: null;
	attempt: null;
	taskId: null;
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

	async listByRunId(
		runId: string,
		limit = 50,
		offset = 0,
		sort?: { order: "asc" | "desc" }
	): Promise<{ rows: Array<WorkflowRunStateTransitionRow | TaskStateTransitionRow>; total: number }> {
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

		return { rows: rows.map(toRunOwnedStateTransitionRow), total: countResult[0]?.count ?? 0 };
	},

	async listByScheduleId(
		scheduleId: string,
		limit = 50,
		offset = 0,
		sort?: { order: "asc" | "desc" }
	): Promise<{ rows: ScheduleStateTransitionRow[]; total: number }> {
		const sortOrder = sort?.order ?? "desc";
		const orderBy = sql`${stateTransition.id} ${sql.raw(sortOrder)}`;

		const [rows, countResult] = await Promise.all([
			db
				.select()
				.from(stateTransition)
				.where(eq(stateTransition.scheduleId, scheduleId))
				.orderBy(orderBy)
				.limit(limit)
				.offset(offset),
			db.select({ count: count() }).from(stateTransition).where(eq(stateTransition.scheduleId, scheduleId)),
		]);

		return { rows: rows.map(toScheduleStateTransitionRow), total: countResult[0]?.count ?? 0 };
	},

	async hasTerminated(
		namespaceId: NamespaceId,
		workflowRunId: string,
		afterStateTransitionId: string
	): Promise<{ runFound: true; terminated: boolean; latestStateTransitionId: string } | { runFound: false }> {
		const result = await db
			.select({
				terminalStateTransitionId: stateTransition.id,
				latestStateTransitionId: workflowRun.latestStateTransitionId,
			})
			.from(workflowRun)
			.leftJoin(
				stateTransition,
				and(
					eq(stateTransition.workflowRunId, workflowRun.id),
					eq(stateTransition.type, "workflow_run"),
					inArray(stateTransition.status, TERMINAL_WORKFLOW_RUN_STATUSES),
					gt(stateTransition.id, afterStateTransitionId)
				)
			)
			.where(and(eq(workflowRun.id, workflowRunId), eq(workflowRun.namespaceId, namespaceId)))
			.limit(1);

		const row = result[0];
		if (!row) {
			return { runFound: false };
		}

		return {
			runFound: true,
			terminated: row.terminalStateTransitionId !== null,
			latestStateTransitionId: row.latestStateTransitionId,
		};
	},
});

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
	if (state.status === "completed" && !("output" in state)) {
		state.output = undefined;
	}
	return state as unknown as TaskState;
}

function toStateTransitionRow(row: _StateTransitionRow): StateTransitionRow {
	const { id, status, createdAt } = row;
	switch (row.type) {
		case "workflow_run": {
			if (row.workflowRunId === null || row.attempt === null || row.taskId !== null || row.scheduleId !== null) {
				throw new Error(`State transition ${id} has columns that do not match type 'workflow_run'`);
			}
			return {
				id,
				status,
				createdAt,
				type: "workflow_run",
				workflowRunId: row.workflowRunId,
				attempt: row.attempt,
				taskId: null,
				scheduleId: null,
				state: toWorkflowRunState(row.state),
			};
		}
		case "task": {
			if (row.workflowRunId === null || row.attempt === null || row.taskId === null || row.scheduleId !== null) {
				throw new Error(`State transition ${id} has columns that do not match type 'task'`);
			}
			return {
				id,
				status,
				createdAt,
				type: "task",
				workflowRunId: row.workflowRunId,
				attempt: row.attempt,
				taskId: row.taskId,
				scheduleId: null,
				state: toTaskState(row.state),
			};
		}
		case "schedule": {
			if (row.scheduleId === null || row.workflowRunId !== null || row.attempt !== null || row.taskId !== null) {
				throw new Error(`State transition ${id} has columns that do not match type 'schedule'`);
			}
			return {
				id,
				status,
				createdAt,
				type: "schedule",
				workflowRunId: null,
				attempt: null,
				taskId: null,
				scheduleId: row.scheduleId,
				state: row.state as ScheduleState,
			};
		}
		default: {
			return row.type satisfies never;
		}
	}
}

function toRunOwnedStateTransitionRow(
	row: _StateTransitionRow
): WorkflowRunStateTransitionRow | TaskStateTransitionRow {
	const narrowed = toStateTransitionRow(row);
	if (narrowed.type !== "workflow_run" && narrowed.type !== "task") {
		throw new Error(`State transition ${row.id} doesn't belong to a run`);
	}
	return narrowed;
}

function toScheduleStateTransitionRow(row: _StateTransitionRow): ScheduleStateTransitionRow {
	const narrowed = toStateTransitionRow(row);
	if (narrowed.type !== "schedule") {
		throw new Error(`State transition ${row.id} doesn't belong to a schedule`);
	}
	return narrowed;
}
