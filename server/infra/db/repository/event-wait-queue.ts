import type { RequiredNonNullableProp } from "@aikirun/lib/object";
import { eq } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { eventWaitQueue } from "../schema/pg";

export type EventWaitQueueRow = typeof eventWaitQueue.$inferSelect;
export type EventWaitQueueRowInsert = typeof eventWaitQueue.$inferInsert;

export function createEventWaitQueueRepository(db: DatabaseConn) {
	return {
		async insert(input: EventWaitQueueRowInsert | EventWaitQueueRowInsert[], tx?: DbTransaction): Promise<void> {
			const values = Array.isArray(input) ? input : [input];
			await (tx ?? db).insert(eventWaitQueue).values(values);
		},

		async upsert(
			input: RequiredNonNullableProp<EventWaitQueueRowInsert, "referenceId">,
			tx?: DbTransaction
		): Promise<void> {
			await (tx ?? db)
				.insert(eventWaitQueue)
				.values(input)
				.onConflictDoNothing({
					target: [eventWaitQueue.workflowRunId, eventWaitQueue.name, eventWaitQueue.referenceId],
				});
		},

		async listByWorkflowRunId(workflowRunId: string, tx?: DbTransaction): Promise<EventWaitQueueRow[]> {
			// TODO: explore loading in chunks
			return (tx ?? db)
				.select()
				.from(eventWaitQueue)
				.where(eq(eventWaitQueue.workflowRunId, workflowRunId))
				.orderBy(eventWaitQueue.id)
				.limit(10_000);
		},
	};
}

export type EventWaitQueueRepository = ReturnType<typeof createEventWaitQueueRepository>;
