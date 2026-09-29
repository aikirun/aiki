import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Database } from "@aikirun/types/infra/db";

export interface WorkflowRunDueTimes {
	scheduledAt: TimestampMs | null;
	wakeupAt: TimestampMs | null;
	timeoutAt: TimestampMs | null;
	nextAttemptAt: TimestampMs | null;
}

export async function readWorkflowRunDueTimes(db: Database, runId: string): Promise<WorkflowRunDueTimes | null> {
	switch (db.provider) {
		case "pg": {
			const { readPgWorkflowRunDueTimes } = await import("./pg/workflow-run");
			return readPgWorkflowRunDueTimes(db, runId);
		}
		case "sqlite": {
			const { readSqliteWorkflowRunDueTimes } = await import("./sqlite/workflow-run");
			return readSqliteWorkflowRunDueTimes(db, runId);
		}
		// case "mysql":
		// 	throw new Error("MySQL support not yet implemented");
		default:
			return db.provider satisfies never;
	}
}
