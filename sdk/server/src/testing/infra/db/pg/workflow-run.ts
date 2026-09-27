import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { eq } from "drizzle-orm";

import { createPgHandle, type PgClient } from "../../../../infra/db/pg/provider";
import { workflowRun } from "../../../../infra/db/pg/schema";

export async function readPgWorkflowRunDueTimes(db: Database, runId: string) {
	const client = db[INTERNAL].client as PgClient;
	const rows = await createPgHandle(client)
		.select({
			scheduledAt: workflowRun.scheduledAt,
			wakeupAt: workflowRun.wakeupAt,
			timeoutAt: workflowRun.timeoutAt,
			nextAttemptAt: workflowRun.nextAttemptAt,
		})
		.from(workflowRun)
		.where(eq(workflowRun.id, runId))
		.limit(1);
	return rows[0] ?? null;
}
