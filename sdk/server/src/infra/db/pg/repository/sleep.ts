import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import { and, eq, inArray } from "drizzle-orm";

import type { PgDb } from "../provider";
import { sleep } from "../schema";

export type SleepRow = typeof sleep.$inferSelect;
type SleepRowInsert = typeof sleep.$inferInsert;

export const createSleepRepository = (db: PgDb) => ({
	async create(input: SleepRowInsert): Promise<void> {
		await db.insert(sleep).values(input);
	},

	async update(
		id: string,
		updates: { status: "completed"; completedAt: TimestampMs } | { status: "cancelled"; cancelledAt: TimestampMs }
	): Promise<void> {
		await db.update(sleep).set(updates).where(eq(sleep.id, id));
	},

	async listByWorkflowRunId(workflowRunId: WorkflowRunId): Promise<SleepRow[]> {
		// TODO: explore loading in chunks
		return db.select().from(sleep).where(eq(sleep.workflowRunId, workflowRunId)).orderBy(sleep.id).limit(10_000);
	},

	async bulkCompleteByWorkflowRunIds(workflowRunIds: NonEmptyArray<string>, completedAt: TimestampMs): Promise<void> {
		await db
			.update(sleep)
			.set({ status: "completed", completedAt })
			.where(and(inArray(sleep.workflowRunId, workflowRunIds), eq(sleep.status, "sleeping")));
	},

	async bulkCancelByWorkflowRunIds(workflowRunIds: NonEmptyArray<string>, cancelledAt: TimestampMs): Promise<void> {
		await db
			.update(sleep)
			.set({ status: "cancelled", cancelledAt })
			.where(and(inArray(sleep.workflowRunId, workflowRunIds), eq(sleep.status, "sleeping")));
	},

	async getActiveByWorkflowRunIdAndName(workflowRunId: WorkflowRunId, name: string): Promise<SleepRow | null> {
		const result = await db
			.select()
			.from(sleep)
			.where(and(eq(sleep.workflowRunId, workflowRunId), eq(sleep.status, "sleeping"), eq(sleep.name, name)))
			.limit(1);
		return result[0] ?? null;
	},
});

export type SleepRepository = ReturnType<typeof createSleepRepository>;
