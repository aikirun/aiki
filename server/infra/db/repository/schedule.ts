import type { NonEmptyArray } from "@aikirun/lib";
import type { NamespaceId } from "@aikirun/types/namespace";
import { and, count, eq, getTableColumns, inArray, lte, sql } from "drizzle-orm";

import type { DatabaseConn, DbTransaction } from "..";
import { schedule, workflow } from "../schema/pg";

export type ScheduleRow = typeof schedule.$inferSelect;
type ScheduleRowInsert = typeof schedule.$inferInsert;
type ScheduleRowUpdate = Partial<
	Pick<
		ScheduleRowInsert,
		| "status"
		| "type"
		| "cronExpression"
		| "intervalMs"
		| "overlapPolicy"
		| "workflowRunInput"
		| "workflowRunInputHash"
		| "definitionHash"
		| "referenceId"
		| "conflictPolicy"
		| "lastOccurrence"
		| "nextRunAt"
		| "workflowId"
	>
>;

export function createScheduleRepository(db: DatabaseConn) {
	return {
		async create(input: ScheduleRowInsert, tx?: DbTransaction): Promise<ScheduleRow> {
			const result = await (tx ?? db).insert(schedule).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create schedule - no row returned");
			}
			return created;
		},

		async update(
			namespaceId: NamespaceId,
			id: string,
			updates: ScheduleRowUpdate,
			tx?: DbTransaction
		): Promise<ScheduleRow | null> {
			const result = await (tx ?? db)
				.update(schedule)
				.set(updates)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.id, id)))
				.returning();
			return result[0] ?? null;
		},

		async bulkUpdateOccurrence(
			entries: NonEmptyArray<{ id: string; lastOccurrence?: Date; nextRunAt: Date }>,
			tx?: DbTransaction
		): Promise<void> {
			const ids: string[] = [];
			const nextRunAtCaseFragments = [];
			const lastOccurrenceCaseFragments = [];

			for (const entry of entries) {
				ids.push(entry.id);
				nextRunAtCaseFragments.push(sql`WHEN ${entry.id} THEN ${entry.nextRunAt}::timestamptz`);
				if (entry.lastOccurrence) {
					lastOccurrenceCaseFragments.push(sql`WHEN ${entry.id} THEN ${entry.lastOccurrence}::timestamptz`);
				}
			}

			const updates: Record<string, unknown> = {
				nextRunAt: sql`CASE ${schedule.id} ${sql.join(nextRunAtCaseFragments, sql` `)} END`,
			};
			if (lastOccurrenceCaseFragments.length > 0) {
				updates.lastOccurrence = sql`CASE ${schedule.id} ${sql.join(lastOccurrenceCaseFragments, sql` `)} ELSE ${schedule.lastOccurrence} END`;
			}

			await (tx ?? db).update(schedule).set(updates).where(inArray(schedule.id, ids));
		},

		async getByReferenceId(
			namespaceId: NamespaceId,
			referenceId: string,
			tx?: DbTransaction
		): Promise<ScheduleRow | null> {
			const result = await (tx ?? db)
				.select()
				.from(schedule)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},

		async getByDefinitionHash(
			namespaceId: NamespaceId,
			definitionHash: string,
			tx?: DbTransaction
		): Promise<ScheduleRow | null> {
			const result = await (tx ?? db)
				.select()
				.from(schedule)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.definitionHash, definitionHash)))
				.limit(1);
			return result[0] ?? null;
		},

		async listByFilters(
			namespaceId: NamespaceId,
			filters: {
				id?: string;
				referenceId?: string;
				status?: string[];
				workflowIds?: string[];
			},
			limit = 50,
			offset = 0,
			tx?: DbTransaction
		) {
			const conn = tx ?? db;

			const conditions = [eq(schedule.namespaceId, namespaceId)];

			if (filters.id) {
				conditions.push(eq(schedule.id, filters.id));
			}
			if (filters.referenceId) {
				conditions.push(eq(schedule.referenceId, filters.referenceId));
			}
			if (filters.status && filters.status.length > 0) {
				conditions.push(inArray(schedule.status, filters.status as typeof schedule.status.enumValues));
			}
			if (filters.workflowIds && filters.workflowIds.length > 0) {
				conditions.push(inArray(schedule.workflowId, filters.workflowIds));
			}

			const whereClause = and(...conditions);

			const [rows, countResult] = await Promise.all([
				conn
					.select({
						schedule: getTableColumns(schedule),
						workflow: { workflowName: workflow.name, workflowVersionId: workflow.versionId },
					})
					.from(schedule)
					.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
					.where(whereClause)
					.orderBy(schedule.createdAt)
					.limit(limit)
					.offset(offset),
				conn.select({ count: count() }).from(schedule).where(whereClause),
			]);

			return { rows, total: countResult[0]?.count ?? 0 };
		},

		async listDueSchedules(before: Date, limit = 100, tx?: DbTransaction) {
			return (tx ?? db)
				.select({
					schedule: getTableColumns(schedule),
					workflow: { workflowName: workflow.name, workflowVersionId: workflow.versionId },
				})
				.from(schedule)
				.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
				.where(and(eq(schedule.status, "active"), lte(schedule.nextRunAt, before)))
				.orderBy(schedule.nextRunAt, schedule.id)
				.limit(limit);
		},

		async getByIdWithWorkflow(namespaceId: NamespaceId, id: string, tx?: DbTransaction) {
			const result = await (tx ?? db)
				.select({
					schedule: getTableColumns(schedule),
					workflow: { workflowName: workflow.name, workflowVersionId: workflow.versionId },
				})
				.from(schedule)
				.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.id, id)))
				.limit(1);
			return result[0] ?? null;
		},

		async getByReferenceIdWithWorkflow(namespaceId: NamespaceId, referenceId: string, tx?: DbTransaction) {
			const result = await (tx ?? db)
				.select({
					schedule: getTableColumns(schedule),
					workflow: { workflowName: workflow.name, workflowVersionId: workflow.versionId },
				})
				.from(schedule)
				.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},
	};
}

export type ScheduleRepository = ReturnType<typeof createScheduleRepository>;
