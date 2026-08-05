import type { RequiredNonNullableProp } from "@aikirun/lib/object";
import { eq } from "drizzle-orm";

import type { PgDb } from "../provider";
import { eventWait } from "../schema";

export type EventWaitRow = typeof eventWait.$inferSelect;
export type EventWaitRowInsert = typeof eventWait.$inferInsert;

export const createEventWaitRepository = (db: PgDb) => ({
	async insert(input: EventWaitRowInsert | EventWaitRowInsert[]): Promise<void> {
		const values = Array.isArray(input) ? input : [input];
		await db.insert(eventWait).values(values);
	},

	async upsert(input: RequiredNonNullableProp<EventWaitRowInsert, "referenceId">): Promise<void> {
		await db
			.insert(eventWait)
			.values(input)
			.onConflictDoNothing({
				target: [eventWait.workflowRunId, eventWait.name, eventWait.referenceId],
			});
	},

	async listByWorkflowRunId(workflowRunId: string): Promise<EventWaitRow[]> {
		// TODO: explore loading in chunks
		return db
			.select()
			.from(eventWait)
			.where(eq(eventWait.workflowRunId, workflowRunId))
			.orderBy(eventWait.id)
			.limit(10_000);
	},
});

export type EventWaitRepository = ReturnType<typeof createEventWaitRepository>;
