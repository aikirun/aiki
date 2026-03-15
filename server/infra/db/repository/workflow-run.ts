import type { NonEmptyArray } from "@aikirun/lib";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunId, WorkflowRunStatus } from "@aikirun/types/workflow-run";
import { NON_TERMINAL_WORKFLOW_RUN_STATUSES } from "@aikirun/types/workflow-run";
import { and, count, eq, inArray, lte, or, sql } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { stateTransition, workflow, workflowRun } from "../schema/pg";

export type WorkflowRunRow = typeof workflowRun.$inferSelect;
export type WorkflowRunRowInsert = typeof workflowRun.$inferInsert;
type WorkflowRunRowUpdate = Partial<
	Pick<
		WorkflowRunRowInsert,
		"status" | "attempts" | "latestStateTransitionId" | "scheduledAt" | "awakeAt" | "timeoutAt" | "nextAttemptAt"
	>
>;

export function createWorkflowRunRepository(db: DatabaseConn) {
	return {
		async insert(input: WorkflowRunRowInsert | NonEmptyArray<WorkflowRunRowInsert>, tx?: DbTransaction): Promise<void> {
			const values = Array.isArray(input) ? input : [input];
			await (tx ?? db).insert(workflowRun).values(values);
		},

		async update(
			filters: { id: WorkflowRunId; revision?: number },
			updates: WorkflowRunRowUpdate,
			tx?: DbTransaction
		): Promise<{ revision: number } | undefined> {
			const conditions = [eq(workflowRun.id, filters.id)];
			if (filters.revision !== undefined) {
				conditions.push(eq(workflowRun.revision, filters.revision));
			}

			const whereClause = and(...conditions);

			const result = await (tx ?? db)
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

		async exists(namespaceId: NamespaceId, id: string, tx?: DbTransaction): Promise<boolean> {
			const result = await (tx ?? db)
				.select({ id: workflowRun.id })
				.from(workflowRun)
				.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.id, id)))
				.limit(1);
			return result.length > 0;
		},

		async getById(namespaceId: NamespaceId, id: string, tx?: DbTransaction): Promise<WorkflowRunRow | null> {
			const result = await (tx ?? db)
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.id, id)))
				.limit(1);
			return result[0] ?? null;
		},

		async getByIdWithState(
			namespaceId: NamespaceId,
			id: string,
			tx?: DbTransaction,
			options?: { forUpdate?: boolean }
		) {
			const query = (tx ?? db)
				.select({
					id: workflowRun.id,
					status: workflowRun.status,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
					latestStateTransitionId: workflowRun.latestStateTransitionId,
					parentWorkflowRunId: workflowRun.parentWorkflowRunId,
					state: stateTransition.state,
				})
				.from(workflowRun)
				.innerJoin(stateTransition, eq(workflowRun.latestStateTransitionId, stateTransition.id))
				.where(and(eq(workflowRun.namespaceId, namespaceId), eq(workflowRun.id, id)))
				.limit(1);

			const result = options?.forUpdate ? await query.for("update") : await query;
			return result[0] ?? null;
		},

		async listByIdsAndStatus(ids: NonEmptyArray<string>, status: WorkflowRunStatus, tx?: DbTransaction) {
			return (tx ?? db)
				.select({
					id: workflowRun.id,
					revision: workflowRun.revision,
					attempts: workflowRun.attempts,
				})
				.from(workflowRun)
				.where(and(inArray(workflowRun.id, ids), eq(workflowRun.status, status)));
		},

		async getChildRuns(
			filters: { parentRunId: string; status?: NonEmptyArray<WorkflowRunStatus> },
			tx?: DbTransaction
		): Promise<WorkflowRunRow[]> {
			// TODO: explore loading in chunks

			const conditions = [eq(workflowRun.parentWorkflowRunId, filters.parentRunId)];
			if (filters.status) {
				conditions.push(inArray(workflowRun.status, filters.status));
			}

			const whereClause = and(...conditions);

			return (tx ?? db).select().from(workflowRun).where(whereClause).limit(10_000);
		},

		async getByWorkflowAndReferenceId(
			workflowId: string,
			referenceId: string,
			tx?: DbTransaction
		): Promise<WorkflowRunRow | null> {
			const conn = tx ?? db;
			const result = await conn
				.select()
				.from(workflowRun)
				.where(and(eq(workflowRun.workflowId, workflowId), eq(workflowRun.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},

		async listByWorkflowAndReferenceIdPairs(
			filters: {
				pairs: NonEmptyArray<{ workflowId: string; referenceId: string }>;
				status?: NonEmptyArray<WorkflowRunStatus>;
			},
			tx?: DbTransaction
		): Promise<WorkflowRunRow[]> {
			const pairConditions = or(
				...filters.pairs.map(({ workflowId, referenceId }) =>
					and(eq(workflowRun.workflowId, workflowId), eq(workflowRun.referenceId, referenceId))
				)
			);
			const conditions = filters.status
				? and(pairConditions, inArray(workflowRun.status, filters.status))
				: pairConditions;

			return (tx ?? db).select().from(workflowRun).where(conditions);
		},

		async listByFilters(
			namespaceId: NamespaceId,
			filters: {
				id?: string;
				status?: NonEmptyArray<WorkflowRunStatus>;
				workflow?: {
					ids: NonEmptyArray<string>;
					referenceId?: string;
				};
			},
			limit: number,
			offset: number,
			sort: { order: "asc" | "desc" },
			tx?: DbTransaction
		) {
			const conn = tx ?? db;

			const conditions = [eq(workflowRun.namespaceId, namespaceId)];
			if (filters.id) {
				conditions.push(eq(workflowRun.id, filters.id));
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
			const orderBy = sql`${workflowRun.id} ${sort.order}`;

			const [rows, countResult] = await Promise.all([
				conn
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
				conn.select({ count: count() }).from(workflowRun).where(whereClause),
			]);

			return { rows, total: countResult[0]?.count ?? 0 };
		},

		async countByStatus(
			filter: { namespaceId: NamespaceId } | { workflowIds: NonEmptyArray<string> },
			tx?: DbTransaction
		): Promise<Array<{ status: WorkflowRunStatus; count: number }>> {
			const whereClause =
				"workflowIds" in filter
					? inArray(workflowRun.workflowId, filter.workflowIds)
					: eq(workflowRun.namespaceId, filter.namespaceId);

			return (tx ?? db)
				.select({
					status: workflowRun.status,
					count: count(),
				})
				.from(workflowRun)
				.where(whereClause)
				.groupBy(workflowRun.status);
		},

		async listDueScheduleRuns(limit = 100, tx?: DbTransaction) {
			return (tx ?? db)
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

		async listSleepElapsedRuns(limit = 100, tx?: DbTransaction) {
			return (tx ?? db)
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

		async listRetryableRuns(limit = 100, tx?: DbTransaction) {
			return (tx ?? db)
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

		async listEventWaitTimedOutRuns(limit = 100, tx?: DbTransaction) {
			return (tx ?? db)
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

		async listChildRunWaitTimedOutRuns(limit = 100, tx?: DbTransaction) {
			return (tx ?? db)
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
			runs: NonEmptyArray<{ id: string; revision: number; stateTransitionId: string }>,
			tx?: DbTransaction
		): Promise<string[]> {
			const orConditions = [];
			const caseFragments = [];

			for (const run of runs) {
				orConditions.push(sql`(${workflowRun.id} = ${run.id} AND ${workflowRun.revision} = ${run.revision})`);
				caseFragments.push(sql`WHEN ${run.id} THEN ${run.stateTransitionId}`);
			}

			const result = await (tx ?? db)
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
			scheduledAt: Date,
			tx?: DbTransaction
		): Promise<string[]> {
			const orConditions = [];
			const stateTransitionCaseFragments = [];

			for (const run of runs) {
				orConditions.push(sql`(${workflowRun.id} = ${run.id} AND ${workflowRun.revision} = ${run.revision})`);
				stateTransitionCaseFragments.push(sql`WHEN ${run.id} THEN ${run.stateTransitionId}`);
			}

			const result = await (tx ?? db)
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

		async bulkTransitionToCancelled(runIds: NonEmptyArray<string>, tx?: DbTransaction): Promise<string[]> {
			const result = await (tx ?? db)
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
			runs: NonEmptyArray<{ id: string; stateTransitionId: string }>,
			tx?: DbTransaction
		): Promise<void> {
			const ids: string[] = [];
			const caseFragments = [];

			for (const run of runs) {
				ids.push(run.id);
				caseFragments.push(sql`WHEN ${run.id} THEN ${run.stateTransitionId}`);
			}

			await (tx ?? db)
				.update(workflowRun)
				.set({
					latestStateTransitionId: sql`CASE ${workflowRun.id} ${sql.join(caseFragments, sql` `)} END`,
				})
				.where(inArray(workflowRun.id, ids));
		},

		async getRunCount(scheduleId: string, tx?: DbTransaction): Promise<number> {
			const result = await (tx ?? db)
				.select({ count: count() })
				.from(workflowRun)
				.where(eq(workflowRun.scheduleId, scheduleId));
			return result[0]?.count ?? 0;
		},

		async getRunCounts(scheduleIds: NonEmptyArray<string>, tx?: DbTransaction): Promise<Map<string, number>> {
			const rows = await (tx ?? db)
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
