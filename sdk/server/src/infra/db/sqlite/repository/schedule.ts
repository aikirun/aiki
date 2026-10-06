import { asNonEmptyArray } from "@aikirun/lib/collection/array";
import { and, count, eq, getTableColumns, inArray, isNull, lte, sql } from "drizzle-orm";

import { keysetStreamCursorFilter } from "./lib/keyset-stream";
import { valuesTable } from "./lib/values-table";
import type { ScheduleRepository } from "../../types/schedule";
import type { SqliteDb } from "../provider";
import { schedule, workflow } from "../schema";

export const createScheduleRepository = (db: SqliteDb): ScheduleRepository => ({
	async createIfMissing(input) {
		const [created] = await db.insert(schedule).values(input).onConflictDoNothing().returning();
		return created ?? null;
	},

	async update(namespaceId, filter, updates) {
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
			.set(
				updates.latestStateTransitionId === undefined
					? updates
					: { ...updates, revision: sql`${schedule.revision} + 1` }
			)
			.where(and(...conditions))
			.returning();
		return result[0] ?? null;
	},

	async bulkUpdateOccurrence(entries) {
		const valueRows = asNonEmptyArray(
			entries.map(
				({ filter, update }) =>
					sql`(${filter.id}, ${filter.nextRunAt}, ${update.lastOccurrence ?? null}, ${update.nextRunAt})`
			)
		);

		// The update applies only while nextRunAt still holds the value the caller read.
		// Every occurrence advance changes nextRunAt, so an update built from an outdated
		// read matches nothing.
		await db
			.update(schedule)
			.set({
				nextRunAt: sql`v.next_run_at`,
				lastOccurrence: sql`COALESCE(v.last_occurrence, ${schedule.lastOccurrence})`,
			})
			.from(valuesTable("v", ["id", "expected_next_run_at", "last_occurrence", "next_run_at"], valueRows))
			.where(sql`${schedule.id} = v.id AND ${schedule.nextRunAt} = v.expected_next_run_at`);
	},

	// Needs no row lock: a transaction holds the database's write lock from its start.
	async get(namespaceId, filter) {
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
			.select()
			.from(schedule)
			.where(and(...conditions))
			.limit(1);
		return result[0] ?? null;
	},

	// Needs no row lock: a transaction holds the database's write lock from its start.
	async listByDefinitionHashes(namespaceId, definitionHashes) {
		return db
			.select()
			.from(schedule)
			.where(and(eq(schedule.namespaceId, namespaceId), inArray(schedule.definitionHash, definitionHashes)));
	},

	async listByFilters(namespaceId, filter, limit = 50, offset = 0) {
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
					workflow: {
						workflowSource: workflow.source,
						workflowName: workflow.name,
						workflowVersionId: workflow.versionId,
					},
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

	async listActiveByIds(_context, ids) {
		return db
			.select({
				schedule: getTableColumns(schedule),
				workflow: {
					workflowSource: workflow.source,
					workflowName: workflow.name,
					workflowVersionId: workflow.versionId,
				},
			})
			.from(schedule)
			.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
			.where(and(eq(schedule.status, "active"), inArray(schedule.id, ids)));
	},

	async listDueSchedules(_context, before, limit, cursor) {
		return db
			.select({
				schedule: getTableColumns(schedule),
				workflow: {
					workflowSource: workflow.source,
					workflowName: workflow.name,
					workflowVersionId: workflow.versionId,
				},
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

	async getByIdWithWorkflow(namespaceId, id) {
		const result = await db
			.select({
				schedule: getTableColumns(schedule),
				workflow: {
					workflowSource: workflow.source,
					workflowName: workflow.name,
					workflowVersionId: workflow.versionId,
				},
			})
			.from(schedule)
			.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
			.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.id, id)))
			.limit(1);
		return result[0] ?? null;
	},

	async getByReferenceIdWithWorkflow(namespaceId, referenceId) {
		const result = await db
			.select({
				schedule: getTableColumns(schedule),
				workflow: {
					workflowSource: workflow.source,
					workflowName: workflow.name,
					workflowVersionId: workflow.versionId,
				},
			})
			.from(schedule)
			.innerJoin(workflow, eq(schedule.workflowId, workflow.id))
			.where(and(eq(schedule.namespaceId, namespaceId), eq(schedule.referenceId, referenceId)))
			.limit(1);
		return result[0] ?? null;
	},
});
