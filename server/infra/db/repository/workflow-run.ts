import { and, eq, lte, sql } from "drizzle-orm";

import type { DatabaseConn } from "..";
import { workflowRun, workflowRunStateTransition } from "../schema/pg";

type WorkflowRunRow = typeof workflowRun.$inferSelect;
type WorkflowRunRowInsert = typeof workflowRun.$inferInsert;
type WorkflowRunRowUpdate = Partial<
	Pick<
		WorkflowRunRowInsert,
		"status" | "attempts" | "latestStateTransitionId" | "scheduledAt" | "awakeAt" | "timeoutAt" | "nextAttemptAt"
	>
>;

export function createWorkflowRunRepository(db: DatabaseConn) {
	return {
		async create(input: WorkflowRunRowInsert): Promise<WorkflowRunRow> {
			const result = await db.insert(workflowRun).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create workflow run - no row returned");
			}
			return created;
		},

		async updateState(id: string, revision: number, changes: WorkflowRunRowUpdate): Promise<WorkflowRunRow | null> {
			const result = await db
				.update(workflowRun)
				.set({
					...changes,
					revision: sql`${workflowRun.revision} + 1`,
				})
				.where(and(eq(workflowRun.id, id), eq(workflowRun.revision, revision)))
				.returning();

			return result[0] ?? null;
		},

		async getById(id: string): Promise<WorkflowRunRow | null> {
			const result = await db.select().from(workflowRun).where(eq(workflowRun.id, id)).limit(1);
			return result[0] ?? null;
		},

		async getByParentRunId(parentRunId: string): Promise<WorkflowRunRow[]> {
			return db.select().from(workflowRun).where(eq(workflowRun.parentWorkflowRunId, parentRunId));
		},

		async getByWorkflowAndReferenceId(workflowId: string, referenceId: string): Promise<WorkflowRunRow | null> {
			const result = await db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.workflowId, workflowId), eq(workflowRun.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},

		async listDueScheduleRuns(before: Date, limit = 100): Promise<WorkflowRunRow[]> {
			return db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "scheduled"), lte(workflowRun.scheduledAt, before)))
				.limit(limit);
		},

		async listSleepElapsedRuns(before: Date, limit = 100): Promise<WorkflowRunRow[]> {
			return db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "sleeping"), lte(workflowRun.awakeAt, before)))
				.limit(limit);
		},

		async listRetryableRuns(before: Date, limit = 100): Promise<WorkflowRunRow[]> {
			return db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "awaiting_retry"), lte(workflowRun.nextAttemptAt, before)))
				.limit(limit);
		},

		async listEventWaitTimedOutRuns(before: Date, limit = 100): Promise<WorkflowRunRow[]> {
			return db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "awaiting_event"), lte(workflowRun.timeoutAt, before)))
				.limit(limit);
		},

		async listChildWorkflowWaitTimedOutRuns(before: Date, limit = 100): Promise<WorkflowRunRow[]> {
			return db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "awaiting_child_workflow"), lte(workflowRun.timeoutAt, before)))
				.limit(limit);
		},
	};
}

export type WorkflowRunRepository = ReturnType<typeof createWorkflowRunRepository>;

type WorkflowRunStateTransitionRow = typeof workflowRunStateTransition.$inferSelect;
type WorkflowRunStateTransitionRowInsert = typeof workflowRunStateTransition.$inferInsert;

export function createWorkflowRunStateTransitionRepository(db: DatabaseConn) {
	return {
		async append(input: WorkflowRunStateTransitionRowInsert): Promise<void> {
			await db.insert(workflowRunStateTransition).values(input);
		},

		async listByRunId(runId: string): Promise<WorkflowRunStateTransitionRow[]> {
			return db
				.select()
				.from(workflowRunStateTransition)
				.where(eq(workflowRunStateTransition.workflowRunId, runId))
				.orderBy(workflowRunStateTransition.createdAt);
		},
	};
}

export type WorkflowRunStateTransitionRepository = ReturnType<typeof createWorkflowRunStateTransitionRepository>;
