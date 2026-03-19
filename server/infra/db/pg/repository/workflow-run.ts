import type { NonEmptyArray } from "@aikirun/lib";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunId, WorkflowRunState, WorkflowRunStatus } from "@aikirun/types/workflow-run";
import { NON_TERMINAL_WORKFLOW_RUN_STATUSES } from "@aikirun/types/workflow-run";
import { and, count, eq, inArray, lte, or, sql } from "drizzle-orm";

import { toWorkflowRunState } from "./state-transition";
import type { PgDb } from "../provider";
import { stateTransition, task, workflow, workflowRun } from "../schema";

export type WorkflowRunRow = typeof workflowRun.$inferSelect;
export type WorkflowRunRowInsert = typeof workflowRun.$inferInsert;
type WorkflowRunRowUpdate = Partial<
	Pick<
		WorkflowRunRowInsert,
		"status" | "attempts" | "latestStateTransitionId" | "scheduledAt" | "awakeAt" | "timeoutAt" | "nextAttemptAt"
	>
>;

export function createWorkflowRunRepository(db: PgDb) {
	return {
		async insert(input: WorkflowRunRowInsert | NonEmptyArray<WorkflowRunRowInsert>): Promise<void> {
			const values = Array.isArray(input) ? input : [input];
			await db.insert(workflowRun).values(values);
		},

		async update(
			filters: { id: WorkflowRunId; revision?: number },
			updates: WorkflowRunRowUpdate
		): Promise<{ revision: number } | undefined> {
			const conditions = [eq(workflowRun.id, filters.id)];
			if (filters.revision !== undefined) {
				conditions.push(eq(workflowRun.revision, filters.revision));
			}

			const whereClause = and(...conditions);

			const result = await db
				.update(workflowRun)
				.set({
					...updates,
					revision: sql`${workflowRun.revision} + 1`,
				})
				.where(whereClause)
				.returning({ revision: workflowRun.revision });

			const revision = result[0]?.revision;
			if (revision === undefined) {
				return undefined;
			}

			return { revision };
		},

		async exists(namespaceId: NamespaceId, id: string): Promise<boolean> {
			const result = await db
				.select({ id: workflowRun.id })
				.from(workflowRun)
				.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.id, id)))
				.limit(1);
			return result.length > 0;
		},

		async getById(namespaceId: NamespaceId, id: string): Promise<WorkflowRunRow | null> {
			const result = await db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.id, id)))
				.limit(1);
			return result[0] ?? null;
		},

		async getByIds(namespaceId: NamespaceId, ids: NonEmptyArray<string>): Promise<WorkflowRunRow[]> {
			return db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.namespaceId, namespaceId), inArray(workflowRun.id, ids)));
		},

		async getByIdWithState(namespaceId: NamespaceId, id: string, options?: { forUpdate?: boolean }) {
			const query = db
				.select({
					id: workflowRun.id,
					status: workflowRun.status,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
					parentWorkflowRunId: workflowRun.parentWorkflowRunId,
					options: workflowRun.options,
					state: stateTransition.state,
				})
				.from(workflowRun)
				.innerJoin(stateTransition, eq(workflowRun.latestStateTransitionId, stateTransition.id))
				.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.id, id)))
				.limit(1);

			const result = options?.forUpdate ? await query.for("update") : await query;
			const row = result[0];
			if (!row) {
				return null;
			}
			(row as Record<string, unknown>).state = toWorkflowRunState(row.state);
			return row as Omit<typeof row, "state"> & { state: WorkflowRunState };
		},

		async listByIdsAndStatus(ids: NonEmptyArray<string>, status: WorkflowRunStatus) {
			return db
				.select({
					id: workflowRun.id,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
				})
				.from(workflowRun)
				.where(and(inArray(workflowRun.id, ids), eq(workflowRun.status, status)));
		},

		async getChildRuns(filters: {
			parentRunId: string;
			status?: NonEmptyArray<WorkflowRunStatus>;
		}): Promise<WorkflowRunRow[]> {
			// TODO: explore loading in chunks

			const conditions = [eq(workflowRun.parentWorkflowRunId, filters.parentRunId)];
			if (filters.status) {
				conditions.push(inArray(workflowRun.status, filters.status));
			}

			const whereClause = and(...conditions);

			return db.select().from(workflowRun).where(whereClause).limit(10_000);
		},

		async hasChildRuns(
			parentRunIds: NonEmptyArray<string>,
			childRunStatus?: NonEmptyArray<WorkflowRunStatus>
		): Promise<Set<string>> {
			const conditions = [inArray(workflowRun.parentWorkflowRunId, parentRunIds)];
			if (childRunStatus) {
				conditions.push(inArray(workflowRun.status, childRunStatus));
			}

			const rows = await db
				.select({ parentWorkflowRunId: workflowRun.parentWorkflowRunId })
				.from(workflowRun)
				.where(and(...conditions))
				.groupBy(workflowRun.parentWorkflowRunId);

			const result = new Set<string>();
			for (const row of rows) {
				if (row.parentWorkflowRunId) {
					result.add(row.parentWorkflowRunId);
				}
			}
			return result;
		},

		async getByWorkflowAndReferenceId(workflowId: string, referenceId: string): Promise<WorkflowRunRow | null> {
			const result = await db
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.workflowId, workflowId), eq(workflowRun.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},

		async listByWorkflowAndReferenceIdPairs(filters: {
			pairs: NonEmptyArray<{ workflowId: string; referenceId: string }>;
			status?: NonEmptyArray<WorkflowRunStatus>;
		}): Promise<WorkflowRunRow[]> {
			const pairConditions = or(
				...filters.pairs.map(({ workflowId, referenceId }) =>
					and(eq(workflowRun.workflowId, workflowId), eq(workflowRun.referenceId, referenceId))
				)
			);
			const conditions = filters.status
				? and(pairConditions, inArray(workflowRun.status, filters.status))
				: pairConditions;

			return db.select().from(workflowRun).where(conditions);
		},

		async listByFilters(
			namespaceId: NamespaceId,
			filters: {
				id?: string;
				scheduleId?: string;
				status?: NonEmptyArray<WorkflowRunStatus>;
				workflow?: {
					ids: NonEmptyArray<string>;
					referenceId?: string;
				};
			},
			limit: number,
			offset: number,
			sort: { order: "asc" | "desc" }
		) {
			const conditions = [eq(workflowRun.namespaceId, namespaceId)];
			if (filters.id) {
				conditions.push(eq(workflowRun.id, filters.id));
			}
			if (filters.scheduleId) {
				conditions.push(eq(workflowRun.scheduleId, filters.scheduleId));
			}
			if (filters.status) {
				conditions.push(inArray(workflowRun.status, filters.status));
			}
			if (filters.workflow) {
				conditions.push(inArray(workflowRun.workflowId, filters.workflow.ids));
				if (filters.workflow.referenceId) {
					conditions.push(eq(workflowRun.referenceId, filters.workflow.referenceId));
				}
			}

			const whereClause = and(...conditions);
			const orderBy = sql`${workflowRun.id} ${sql.raw(sort.order)}`;

			const [rows, countResult] = await Promise.all([
				db
					.select({
						id: workflowRun.id,
						status: workflowRun.status,
						referenceId: workflowRun.referenceId,
						createdAt: workflowRun.createdAt,
						name: workflow.name,
						versionId: workflow.versionId,
					})
					.from(workflowRun)
					.innerJoin(workflow, eq(workflowRun.workflowId, workflow.id))
					.where(whereClause)
					.orderBy(orderBy)
					.limit(limit)
					.offset(offset),
				db.select({ count: count() }).from(workflowRun).where(whereClause),
			]);

			return { rows, total: countResult[0]?.count ?? 0 };
		},

		async getTaskCountsByRunIds(runIds: NonEmptyArray<string>): Promise<Map<string, Record<TaskStatus, number>>> {
			const rows = await db
				.select({
					workflowRunId: task.workflowRunId,
					status: task.status,
					count: count(),
				})
				.from(task)
				.where(inArray(task.workflowRunId, runIds))
				.groupBy(task.workflowRunId, task.status);

			const result = new Map<string, Record<TaskStatus, number>>();
			for (const row of rows) {
				let taskCounts = result.get(row.workflowRunId);
				if (!taskCounts) {
					taskCounts = { completed: 0, running: 0, failed: 0, awaiting_retry: 0 };
					result.set(row.workflowRunId, taskCounts);
				}
				taskCounts[row.status] = row.count;
			}
			return result;
		},

		async countByStatus(
			filter: { namespaceId: NamespaceId } | { workflowIds: NonEmptyArray<string> }
		): Promise<Array<{ status: WorkflowRunStatus; count: number }>> {
			const whereClause =
				"workflowIds" in filter
					? inArray(workflowRun.workflowId, filter.workflowIds)
					: eq(workflowRun.namespaceId, filter.namespaceId);

			return db
				.select({
					status: workflowRun.status,
					count: count(),
				})
				.from(workflowRun)
				.where(whereClause)
				.groupBy(workflowRun.status);
		},

		async listDueScheduleRuns(limit = 100) {
			return db
				.select({
					id: workflowRun.id,
					namespaceId: workflowRun.namespaceId,
					workflowId: workflowRun.workflowId,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
					options: workflowRun.options,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
				})
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "scheduled"), lte(workflowRun.scheduledAt, new Date())))
				.orderBy(workflowRun.scheduledAt, workflowRun.id)
				.limit(limit);
		},

		async listSleepElapsedRuns(limit = 100) {
			return db
				.select({
					id: workflowRun.id,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
				})
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "sleeping"), lte(workflowRun.awakeAt, new Date())))
				.orderBy(workflowRun.awakeAt, workflowRun.id)
				.limit(limit);
		},

		async listRetryableRuns(limit = 100) {
			return db
				.select({
					id: workflowRun.id,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
				})
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "awaiting_retry"), lte(workflowRun.nextAttemptAt, new Date())))
				.orderBy(workflowRun.nextAttemptAt, workflowRun.id)
				.limit(limit);
		},

		async listEventWaitTimedOutRuns(limit = 100) {
			return db
				.select({
					id: workflowRun.id,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
				})
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "awaiting_event"), lte(workflowRun.timeoutAt, new Date())))
				.orderBy(workflowRun.timeoutAt, workflowRun.id)
				.limit(limit);
		},

		async listChildRunWaitTimedOutRuns(limit = 100) {
			return db
				.select({
					id: workflowRun.id,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
				})
				.from(workflowRun)
				.where(and(eq(workflowRun.status, "awaiting_child_workflow"), lte(workflowRun.timeoutAt, new Date())))
				.orderBy(workflowRun.timeoutAt, workflowRun.id)
				.limit(limit);
		},

		async bulkTransitionToQueued(
			runs: NonEmptyArray<{ id: string; revision: number; stateTransitionId: string }>
		): Promise<string[]> {
			const orConditions = [];
			const caseFragments = [];

			for (const run of runs) {
				orConditions.push(sql`(${workflowRun.id} = ${run.id} AND ${workflowRun.revision} = ${run.revision})`);
				caseFragments.push(sql`WHEN ${run.id} THEN ${run.stateTransitionId}`);
			}

			const result = await db
				.update(workflowRun)
				.set({
					status: "queued",
					revision: sql`${workflowRun.revision} + 1`,
					scheduledAt: null,
					latestStateTransitionId: sql`CASE ${workflowRun.id} ${sql.join(caseFragments, sql` `)} END`,
				})
				.where(and(eq(workflowRun.status, "scheduled"), or(...orConditions)))
				.returning({ id: workflowRun.id });

			return result.map((row) => row.id);
		},

		async bulkTransitionToScheduled(
			fromStatus: WorkflowRunStatus,
			runs: NonEmptyArray<{ id: string; revision: number; stateTransitionId: string }>,
			scheduledAt: Date
		): Promise<string[]> {
			const orConditions = [];
			const stateTransitionCaseFragments = [];

			for (const run of runs) {
				orConditions.push(sql`(${workflowRun.id} = ${run.id} AND ${workflowRun.revision} = ${run.revision})`);
				stateTransitionCaseFragments.push(sql`WHEN ${run.id} THEN ${run.stateTransitionId}`);
			}

			const result = await db
				.update(workflowRun)
				.set({
					status: "scheduled",
					revision: sql`${workflowRun.revision} + 1`,
					scheduledAt,
					awakeAt: null,
					timeoutAt: null,
					nextAttemptAt: null,
					latestStateTransitionId: sql`CASE ${workflowRun.id} ${sql.join(stateTransitionCaseFragments, sql` `)} END`,
				})
				.where(and(eq(workflowRun.status, fromStatus), or(...orConditions)))
				.returning({ id: workflowRun.id });

			return result.map((row) => row.id);
		},

		async bulkTransitionToCancelled(runIds: NonEmptyArray<string>): Promise<string[]> {
			const result = await db
				.update(workflowRun)
				.set({
					status: "cancelled",
					revision: sql`${workflowRun.revision} + 1`,
					scheduledAt: null,
					awakeAt: null,
					timeoutAt: null,
					nextAttemptAt: null,
				})
				.where(and(inArray(workflowRun.id, runIds), inArray(workflowRun.status, NON_TERMINAL_WORKFLOW_RUN_STATUSES)))
				.returning({ id: workflowRun.id });

			return result.map((row) => row.id);
		},

		async bulkSetLatestStateTransitionId(
			runs: NonEmptyArray<{ id: string; stateTransitionId: string }>
		): Promise<void> {
			const ids: string[] = [];
			const caseFragments = [];

			for (const run of runs) {
				ids.push(run.id);
				caseFragments.push(sql`WHEN ${run.id} THEN ${run.stateTransitionId}`);
			}

			await db
				.update(workflowRun)
				.set({
					latestStateTransitionId: sql`CASE ${workflowRun.id} ${sql.join(caseFragments, sql` `)} END`,
				})
				.where(inArray(workflowRun.id, ids));
		},

		async getRunCount(scheduleId: string): Promise<number> {
			const result = await db
				.select({ count: count() })
				.from(workflowRun)
				.where(eq(workflowRun.scheduleId, scheduleId));
			return result[0]?.count ?? 0;
		},

		async getRunCounts(scheduleIds: NonEmptyArray<string>): Promise<Map<string, number>> {
			const rows = await db
				.select({ scheduleId: workflowRun.scheduleId, count: count() })
				.from(workflowRun)
				.where(inArray(workflowRun.scheduleId, scheduleIds))
				.groupBy(workflowRun.scheduleId);

			const map = new Map<string, number>();
			for (const row of rows) {
				if (row.scheduleId) {
					map.set(row.scheduleId, row.count);
				}
			}
			return map;
		},
	};
}

export type WorkflowRunRepository = ReturnType<typeof createWorkflowRunRepository>;
