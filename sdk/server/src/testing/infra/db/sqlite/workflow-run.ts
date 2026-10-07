import type { SqliteClient } from "@aikirun/lib/db/sqlite";
import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { eq } from "drizzle-orm";

import { createSqliteHandle } from "../../../../infra/db/sqlite/provider";
import { workflowRun } from "../../../../infra/db/sqlite/schema";

export async function readSqliteWorkflowRunDueTimes(db: Database, runId: string) {
	const client = db[INTERNAL].client as SqliteClient;
	const rows = await createSqliteHandle(client)
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
