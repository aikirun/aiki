import type { NonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import { and, eq, inArray } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { sleepQueue } from "../schema/pg";

export type SleepQueueRow = typeof sleepQueue.$inferSelect;
type SleepQueueRowInsert = typeof sleepQueue.$inferInsert;

export function createSleepQueueRepository(db: DatabaseConn) {
	return {
		async create(input: SleepQueueRowInsert, tx?: DbTransaction): Promise<void> {
			await (tx ?? db).insert(sleepQueue).values(input);
		},

		async update(
			id: string,
			updates: { status: "completed"; completedAt: Date } | { status: "cancelled"; cancelledAt: Date },
			tx?: DbTransaction
		): Promise<void> {
			await (tx ?? db).update(sleepQueue).set(updates).where(eq(sleepQueue.id, id));
		},

		async listByWorkflowRunId(workflowRunId: WorkflowRunId, tx?: DbTransaction): Promise<SleepQueueRow[]> {
			// TODO: explore loading in chunks
			return (tx ?? db)
				.select()
				.from(sleepQueue)
				.where(eq(sleepQueue.workflowRunId, workflowRunId))
				.orderBy(sleepQueue.id)
				.limit(10_000);
		},

		async bulkCompleteByWorkflowRunIds(
			workflowRunIds: NonEmptyArray<string>,
			completedAt: Date,
			tx?: DbTransaction
		): Promise<void> {
			await (tx ?? db)
				.update(sleepQueue)
				.set({ status: "completed", completedAt })
				.where(and(inArray(sleepQueue.workflowRunId, workflowRunIds), eq(sleepQueue.status, "sleeping")));
		},

		async getActiveByWorkflowRunIdAndName(
			workflowRunId: WorkflowRunId,
			name: string,
			tx?: DbTransaction
		): Promise<SleepQueueRow | null> {
			const result = await (tx ?? db)
				.select()
				.from(sleepQueue)
				.where(
					and(eq(sleepQueue.workflowRunId, workflowRunId), eq(sleepQueue.status, "sleeping"), eq(sleepQueue.name, name))
				)
				.limit(1);
			return result[0] ?? null;
		},
	};
}

export type SleepQueueRepository = ReturnType<typeof createSleepQueueRepository>;
