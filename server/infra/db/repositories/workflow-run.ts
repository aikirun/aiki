import { and, eq, lte, sql } from "drizzle-orm";

import type { Database } from "..";
import { workflowRun, workflowRunStateTransition } from "../schema/pg";

type WorkflowRunRow = typeof workflowRun.$inferSelect;
type WorkflowRunRowInsert = typeof workflowRun.$inferInsert;
type WorkflowRunRowUpdate = Partial<
	Pick<
		WorkflowRunRowInsert,
		"status" | "attempts" | "latestStateTransitionId" | "scheduledAt" | "awakeAt" | "timeoutAt" | "nextAttemptAt"
	>
>;

export interface WorkflowRunRepository {
	create(input: WorkflowRunRowInsert): Promise<WorkflowRunRow>;
	updateState(id: string, revision: number, changes: WorkflowRunRowUpdate): Promise<WorkflowRunRow | null>;
	getById(id: string): Promise<WorkflowRunRow | null>;
	getByParentRunId(parentRunId: string): Promise<WorkflowRunRow[]>;
	getByWorkflowAndReferenceId(workflowId: string, referenceId: string): Promise<WorkflowRunRow | null>;
	listDueScheduleRuns(before: Date, limit?: number): Promise<WorkflowRunRow[]>;
	listSleepElapsedRuns(before: Date, limit?: number): Promise<WorkflowRunRow[]>;
	listRetryableRuns(before: Date, limit?: number): Promise<WorkflowRunRow[]>;
	listEventWaitTimedOutRuns(before: Date, limit?: number): Promise<WorkflowRunRow[]>;
	listChildWorkflowWaitTimedOutRuns(before: Date, limit?: number): Promise<WorkflowRunRow[]>;
}

export function createWorkflowRunRepository(db: Database): WorkflowRunRepository {
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

type WorkflowRunStateTransitionRow = typeof workflowRunStateTransition.$inferSelect;
type WorkflowRunStateTransitionRowInsert = typeof workflowRunStateTransition.$inferInsert;

export interface WorkflowRunStateTransitionRepository {
	append(input: WorkflowRunStateTransitionRowInsert): Promise<void>;
	listByRunId(runId: string): Promise<WorkflowRunStateTransitionRow[]>;
}

export function createWorkflowRunStateTransitionRepository(db: Database): WorkflowRunStateTransitionRepository {
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
