import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";
import { and, count, eq, getTableColumns, inArray, isNull, lte, sql } from "drizzle-orm";

import { keysetStreamCursorFilter } from "./lib/keyset-stream";
import { ScheduleConflictError } from "../../../../errors";
import type { KeysetStreamCursor } from "../../../../lib/keyset-stream";
import type { DaemonContext } from "../../../../middleware/context";
import type { PgDb } from "../provider";
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
		| "workflowRunOptions"
		| "lastOccurrence"
		| "nextRunAt"
		| "workflowId"
	>
>;

export const createScheduleRepository = (db: PgDb) => ({
	async create(input: ScheduleRowInsert): Promise<ScheduleRow> {
		const [created] = await db.insert(schedule).values(input).onConflictDoNothing().returning();
		if (!created) {
			throw new ScheduleConflictError({
				definitionHash: input.definitionHash,
				referenceId: input.referenceId ?? undefined,
			});
		}
		return created;
	},

	async update(
		namespaceId: NamespaceId,
		filter: { id: string; referenceId?: string | null },
		updates: ScheduleRowUpdate
	): Promise<ScheduleRow | null> {
		const conditions = [eq(schedule.namespaceId, namespaceId)];

		if (filter.id) {
			conditions.push(eq(schedule.id, filter.id));
		}
		if (filter.referenceId !== undefined) {
			if (filter.referenceId === null) {
				conditions.push(isNull(schedule.referenceId));
			} else {
				conditions.push(eq(schedule.referenceId, filter.referenceId));
			}
		}

		const result = await db
			.update(schedule)
			.set(updates)
			.where(and(...conditions))
			.returning();
		return result[0] ?? null;
	},

	async bulkUpdateOccurrence(
		entries: NonEmptyArray<{ id: string; lastOccurrence?: TimestampMs; nextRunAt: TimestampMs }>
	): Promise<void> {
		const valueRows = entries.map((entry, index) => {
			const lastOccurrenceIso = entry.lastOccurrence ? new Date(entry.lastOccurrence).toISOString() : null;
			const nextRunAtIso = new Date(entry.nextRunAt).toISOString();
			if (index === 0) {
				return sql`(${entry.id}::text, ${nextRunAtIso}::timestamptz, ${lastOccurrenceIso}::timestamptz)`;
			}
			return sql`(${entry.id}, ${nextRunAtIso}, ${lastOccurrenceIso})`;
		});

		await db
			.update(schedule)
			.set({
				nextRunAt: sql`v.next_run_at`,
				lastOccurrence: sql`COALESCE(v.last_occurrence, ${schedule.lastOccurrence})`,
			})
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, next_run_at, last_occurrence)`)
			.where(sql`${schedule.id} = v.id`);
	},

	async get(
		namespaceId: NamespaceId,
		filter: { definitionHash?: string; referenceId?: string | null }
	): Promise<ScheduleRow | null> {
		const conditions = [eq(schedule.namespaceId, namespaceId)];

		if (filter.definitionHash) {
			conditions.push(eq(schedule.definitionHash, filter.definitionHash));
		}
		if (filter.referenceId !== undefined) {
			if (filter.referenceId === null) {
				conditions.push(isNull(schedule.referenceId));
			} else {
				conditions.push(eq(schedule.referenceId, filter.referenceId));
			}
		}

		const result = await db
			.select()
			.from(schedule)
			.where(and(...conditions))
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

	async listDueSchedules(_context: DaemonContext, before: TimestampMs, limit: number, cursor?: KeysetStreamCursor) {
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
					keysetStreamCursorFilter(schedule.nextRunAt, schedule.id, cursor)
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
});

export type ScheduleRepository = ReturnType<typeof createScheduleRepository>;
