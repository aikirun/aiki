import type { RequiredNonNullableProp } from "@aikirun/lib/object";
import { eq } from "drizzle-orm";

import type { EventWaitRepository, EventWaitRowInsert } from "../../types/event-wait";
import type { SqliteDb } from "../provider";
import { eventWait } from "../schema";

export const createEventWaitRepository = (db: SqliteDb): EventWaitRepository => ({
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

	async listByWorkflowRunId(workflowRunId) {
		// TODO: explore loading in chunks
		return db
			.select()
			.from(eventWait)
			.where(eq(eventWait.workflowRunId, workflowRunId))
			.orderBy(eventWait.signalSequence, eventWait.id)
			.limit(10_000);
	},
});
