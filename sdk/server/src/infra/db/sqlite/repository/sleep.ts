import { and, eq, inArray } from "drizzle-orm";

import type { SleepRepository } from "../../types/sleep";
import type { SqliteDb } from "../provider";
import { sleep } from "../schema";

export const createSleepRepository = (db: SqliteDb): SleepRepository => ({
	async create(input) {
		await db.insert(sleep).values(input);
	},

	async update(id, updates) {
		await db.update(sleep).set(updates).where(eq(sleep.id, id));
	},

	async listByWorkflowRunId(workflowRunId) {
		// TODO: explore loading in chunks
		return db.select().from(sleep).where(eq(sleep.workflowRunId, workflowRunId)).orderBy(sleep.id).limit(10_000);
	},

	async bulkCompleteByWorkflowRunIds(workflowRunIds, completedAt) {
		await db
			.update(sleep)
			.set({ status: "completed", completedAt })
			.where(and(inArray(sleep.workflowRunId, workflowRunIds), eq(sleep.status, "sleeping")));
	},

	async bulkCancelByWorkflowRunIds(workflowRunIds, cancelledAt) {
		await db
			.update(sleep)
			.set({ status: "cancelled", cancelledAt })
			.where(and(inArray(sleep.workflowRunId, workflowRunIds), eq(sleep.status, "sleeping")));
	},

	async getActiveByWorkflowRunIdAndName(workflowRunId, name) {
		const result = await db
			.select()
			.from(sleep)
			.where(and(eq(sleep.workflowRunId, workflowRunId), eq(sleep.status, "sleeping"), eq(sleep.name, name)))
			.limit(1);
		return result[0] ?? null;
	},
});
