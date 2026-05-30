import type { NonEmptyArray } from "@aikirun/lib/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import { and, count, eq, getTableColumns, inArray, lte, type SQL, sql } from "drizzle-orm";

import { timerStreamCursorFilter } from "./lib/timer-stream";
import type { TimerStreamCursor } from "../../../../lib/timer-stream";
import type { DaemonContext } from "../../../../middleware/context";
import type { SqliteDb } from "../provider";
import { schedule, workflow } from "../schema";

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

export function createScheduleRepository(db: SqliteDb) {
	return {
		async create(input: ScheduleRowInsert): Promise<ScheduleRow> {
			const result = await db.insert(schedule).values(input).returning();
			const created = result[0];
			if (!created) {
				throw new Error("Failed to create schedule - no row returned");
			}
			return created;
		},

		async update(namespaceId: NamespaceId, id: string, updates: ScheduleRowUpdate): Promise<ScheduleRow | null> {
			const result = await db
				.update(schedule)
				.set(updates)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.id, id)))
				.returning();
			return result[0] ?? null;
		},

		async bulkUpdateOccurrence(
			entries: NonEmptyArray<{ id: string; lastOccurrence?: Date; nextRunAt: Date }>
		): Promise<void> {
			// SQLite has no UPDATE ... FROM (VALUES ...), so drive the per-row updates with CASE.
			const ids = entries.map((entry) => entry.id);
			const nextRunAtCases = entries.map((entry) => sql`WHEN ${entry.id} THEN ${entry.nextRunAt.toISOString()}`);
			const lastOccurrenceCases: SQL[] = [];
			for (const entry of entries) {
				if (entry.lastOccurrence) {
					lastOccurrenceCases.push(sql`WHEN ${entry.id} THEN ${entry.lastOccurrence.toISOString()}`);
				}
			}

			const nextRunAtCase = sql`CASE ${schedule.id} ${sql.join(nextRunAtCases, sql` `)} END`;

			if (lastOccurrenceCases.length > 0) {
				const lastOccurrenceCase = sql`CASE ${schedule.id} ${sql.join(lastOccurrenceCases, sql` `)} ELSE ${schedule.lastOccurrence} END`;
				await db
					.update(schedule)
					.set({ nextRunAt: nextRunAtCase, lastOccurrence: lastOccurrenceCase })
					.where(inArray(schedule.id, ids));
			} else {
				await db.update(schedule).set({ nextRunAt: nextRunAtCase }).where(inArray(schedule.id, ids));
			}
		},

		async getByReferenceId(namespaceId: NamespaceId, referenceId: string): Promise<ScheduleRow | null> {
			const result = await db
				.select()
				.from(schedule)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.referenceId, referenceId)))
				.limit(1);
			return result[0] ?? null;
		},

		async getByDefinitionHash(namespaceId: NamespaceId, definitionHash: string): Promise<ScheduleRow | null> {
			const result = await db
				.select()
				.from(schedule)
				.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.definitionHash, definitionHash)))
				.limit(1);
			return result[0] ?? null;
		},

		async listByFilters(
			namespaceId: NamespaceId,
			filter: {
				id?: string;
				referenceId?: string;
				status?: string[];
				workflowIds?: string[];
			},
			limit = 50,
			offset = 0
		) {
			const conditions = [eq(schedule.namespaceId, namespaceId)];

			if (filter.id) {
				conditions.push(eq(schedule.id, filter.id));
			}
			if (filter.referenceId) {
				conditions.push(eq(schedule.referenceId, filter.referenceId));
			}
			if (filter.status && filter.status.length > 0) {
				conditions.push(inArray(schedule.status, filter.status as typeof schedule.status.enumValues));
			}
			if (filter.workflowIds && filter.workflowIds.length > 0) {
				conditions.push(inArray(schedule.workflowId, filter.workflowIds));
			}

			const whereClause = and(...conditions);

			const [rows, countResult] = await Promise.all([
				db
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
				db.select({ count: count() }).from(schedule).where(whereClause),
			]);

			return { rows, total: countResult[0]?.count ?? 0 };
		},

		async listActiveByIds(_context: DaemonContext, ids: NonEmptyArray<string>) {
			return db
				.select({
					schedule: getTableColumns(schedule),
					workflow: { workflowName: workflow.name, workflowVersionId: workflow.versionId },
				})
				.from(schedule)
				.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
				.where(and(eq(schedule.status, "active"), inArray(schedule.id, ids)));
		},

		async listDueSchedules(_context: DaemonContext, before: Date, limit: number, cursor?: TimerStreamCursor) {
			return db
				.select({
					schedule: {
						...getTableColumns(schedule),
						nextRunAt: sql<Date>`${schedule.nextRunAt}`.mapWith(schedule.nextRunAt),
					},
					workflow: { workflowName: workflow.name, workflowVersionId: workflow.versionId },
				})
				.from(schedule)
				.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
				.where(
					and(
						eq(schedule.status, "active"),
						lte(schedule.nextRunAt, before),
						timerStreamCursorFilter(schedule.nextRunAt, schedule.id, cursor)
					)
				)
				.orderBy(schedule.nextRunAt, schedule.id)
				.limit(limit);
		},

		async getByIdWithWorkflow(namespaceId: NamespaceId, id: string) {
			const result = await db
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

		async getByReferenceIdWithWorkflow(namespaceId: NamespaceId, referenceId: string) {
			const result = await db
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
