import type { RequiredNonNullableProp } from "@aikirun/lib/object";
import { eq } from "drizzle-orm";

import type { SqliteDb } from "../provider";
import { eventWaitQueue } from "../schema";

export type EventWaitQueueRow = typeof eventWaitQueue.$inferSelect;
export type EventWaitQueueRowInsert = typeof eventWaitQueue.$inferInsert;

export function createEventWaitQueueRepository(db: SqliteDb) {
	return {
		async insert(input: EventWaitQueueRowInsert | EventWaitQueueRowInsert[]): Promise<void> {
			const values = Array.isArray(input) ? input : [input];
			await db.insert(eventWaitQueue).values(values);
		},

		async upsert(input: RequiredNonNullableProp<EventWaitQueueRowInsert, "referenceId">): Promise<void> {
			await db
				.insert(eventWaitQueue)
				.values(input)
				.onConflictDoNothing({
					target: [eventWaitQueue.workflowRunId, eventWaitQueue.name, eventWaitQueue.referenceId],
				});
		},

		async listByWorkflowRunId(workflowRunId: string): Promise<EventWaitQueueRow[]> {
			// TODO: explore loading in chunks
			return db
				.select()
				.from(eventWaitQueue)
				.where(eq(eventWaitQueue.workflowRunId, workflowRunId))
				.orderBy(eventWaitQueue.id)
				.limit(10_000);
		},
	};
}

export type EventWaitQueueRepository = ReturnType<typeof createEventWaitQueueRepository>;
