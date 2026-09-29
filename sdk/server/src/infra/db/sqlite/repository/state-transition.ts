import { asc, count, desc, eq, inArray } from "drizzle-orm";

import {
	toRunOwnedStateTransitionRow,
	toScheduleStateTransitionRow,
	toStateTransitionRow,
} from "../../state-transition-row";
import type { StateTransitionRepository } from "../../types/state-transition";
import type { SqliteDb } from "../provider";
import { stateTransition, stateTransitionTypeOrder } from "../schema";

export const createStateTransitionRepository = (db: SqliteDb): StateTransitionRepository => ({
	async append(input) {
		await db.insert(stateTransition).values(input);
	},

	async appendBatch(inputs) {
		await db.insert(stateTransition).values(inputs);
	},

	async getById(id) {
		const result = await db.select().from(stateTransition).where(eq(stateTransition.id, id)).limit(1);
		const row = result[0];
		return row ? toStateTransitionRow(row) : null;
	},

	async getByIds(ids) {
		const rows = await db.select().from(stateTransition).where(inArray(stateTransition.id, ids));
		return rows.map(toStateTransitionRow);
	},

	async listByRunId(runId, limit = 50, offset = 0, sort) {
		const direction = sort?.order === "asc" ? asc : desc;

		const [rows, countResult] = await Promise.all([
			db
				.select()
				.from(stateTransition)
				.where(eq(stateTransition.workflowRunId, runId))
				.orderBy(
					direction(stateTransition.revision),
					direction(stateTransitionTypeOrder(stateTransition.type)),
					direction(stateTransition.id)
				)
				.limit(limit)
				.offset(offset),
			db.select({ count: count() }).from(stateTransition).where(eq(stateTransition.workflowRunId, runId)),
		]);

		return { rows: rows.map(toRunOwnedStateTransitionRow), total: countResult[0]?.count ?? 0 };
	},

	async listByScheduleId(scheduleId, limit = 50, offset = 0, sort) {
		const direction = sort?.order === "asc" ? asc : desc;

		const [rows, countResult] = await Promise.all([
			db
				.select()
				.from(stateTransition)
				.where(eq(stateTransition.scheduleId, scheduleId))
				.orderBy(direction(stateTransition.revision), direction(stateTransition.id))
				.limit(limit)
				.offset(offset),
			db.select({ count: count() }).from(stateTransition).where(eq(stateTransition.scheduleId, scheduleId)),
		]);

		return { rows: rows.map(toScheduleStateTransitionRow), total: countResult[0]?.count ?? 0 };
	},
});
