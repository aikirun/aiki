import type { NonEmptyArray } from "@aikirun/lib";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowSource } from "@aikirun/types/workflow";
import type { WorkflowListRequestV1, WorkflowListVersionsRequestV1 } from "@aikirun/types/workflow-api";
import { and, count, eq, inArray, max, or, sql } from "drizzle-orm";
import { ulid } from "ulidx";

import type { DatabaseConn, DbTransaction } from "..";
import { workflow, workflowRun } from "../schema/pg";

export type WorkflowRow = typeof workflow.$inferSelect;
export type WorkflowRowInsert = Omit<typeof workflow.$inferInsert, "id">;

export function createWorkflowRepository(db: DatabaseConn) {
	return {
		async getById(namespaceId: NamespaceId, id: string, tx?: DbTransaction): Promise<WorkflowRow | null> {
			const result = await (tx ?? db)
				.select()
				.from(workflow)
				.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.id, id)))
				.limit(1);
			return result[0] ?? null;
		},

		async getByIds(namespaceId: NamespaceId, ids: NonEmptyArray<string>, tx?: DbTransaction): Promise<WorkflowRow[]> {
			return (tx ?? db)
				.select()
				.from(workflow)
				.where(and(eq(workflow.namespaceId, namespaceId), inArray(workflow.id, ids)));
		},

		async getByIdsGlobal(ids: NonEmptyArray<string>, tx?: DbTransaction): Promise<WorkflowRow[]> {
			return (tx ?? db).select().from(workflow).where(inArray(workflow.id, ids));
		},

		async getByNameAndVersion(
			namespaceId: NamespaceId,
			filter: { name: string; versionId: string; source: WorkflowSource },
			tx?: DbTransaction
		): Promise<WorkflowRow | null> {
			const result = await (tx ?? db)
				.select()
				.from(workflow)
				.where(
					and(
						eq(workflow.namespaceId, namespaceId),
						eq(workflow.source, filter.source),
						eq(workflow.name, filter.name),
						eq(workflow.versionId, filter.versionId)
					)
				)
				.limit(1);
			return result[0] ?? null;
		},

		async getOrCreate(
			{ namespaceId, name, versionId, source }: WorkflowRowInsert,
			tx?: DbTransaction
		): Promise<WorkflowRow> {
			const result = await (tx ?? db)
				.insert(workflow)
				.values({ id: ulid(), namespaceId, name, versionId, source })
				.onConflictDoUpdate({
					target: [workflow.namespaceId, workflow.source, workflow.name, workflow.versionId],
					set: { name: sql`excluded.name` },
				})
				.returning();
			const row = result[0];
			if (!row) {
				throw new Error("Failed to get or create workflow - no row returned");
			}
			return row;
		},

		async getOrCreateBulk(entries: NonEmptyArray<WorkflowRowInsert>, tx?: DbTransaction): Promise<WorkflowRow[]> {
			return (tx ?? db)
				.insert(workflow)
				.values(entries.map((entry) => ({ id: ulid(), ...entry })))
				.onConflictDoUpdate({
					target: [workflow.namespaceId, workflow.source, workflow.name, workflow.versionId],
					set: { name: sql`excluded.name` },
				})
				.returning();
		},

		async listByNameAndVersion(
			namespaceId: NamespaceId,
			request: { name: string; versionId?: string; source: WorkflowSource },
			tx?: DbTransaction
		): Promise<WorkflowRow[]> {
			const { name, versionId, source } = request;
			return (tx ?? db)
				.select()
				.from(workflow)
				.where(
					and(
						eq(workflow.namespaceId, namespaceId),
						eq(workflow.source, source),
						eq(workflow.name, name),
						versionId !== undefined ? eq(workflow.versionId, versionId) : undefined
					)
				);
		},

		async listByNameAndVersionPairs(
			namespaceId: NamespaceId,
			pairs: NonEmptyArray<{ name: string; versionId?: string; source: WorkflowSource }>,
			tx?: DbTransaction
		): Promise<WorkflowRow[]> {
			return (tx ?? db)
				.select()
				.from(workflow)
				.where(
					and(
						eq(workflow.namespaceId, namespaceId),
						or(
							...pairs.map(({ name, versionId, source }) =>
								and(
									eq(workflow.source, source),
									eq(workflow.name, name),
									versionId ? eq(workflow.versionId, versionId) : undefined
								)
							)
						)
					)
				);
		},

		async listWithStats(
			namespaceId: NamespaceId,
			request: WorkflowListRequestV1,
			tx?: DbTransaction
		): Promise<{
			items: Array<{ name: string; runCount: number; lastRunId: string | null }>;
			total: number;
		}> {
			const conn = tx ?? db;

			const { source, limit = 50, offset = 0, sort } = request;

			const sortField = sort?.field ?? "name";
			const sortOrder = sort?.order ?? "asc";

			const dir = sql.raw(sortOrder);

			const orderByClause =
				sortField === "name"
					? sql`${workflow.name} ${dir}`
					: sortField === "runCount"
						? sql`count(${workflowRun.id}) ${dir}`
						: (sortField satisfies "lastRunAt") &&
							sql`max(${workflowRun.id}) ${dir} nulls ${sql.raw(sortOrder === "asc" ? "first" : "last")}`;

			const items = await conn
				.select({
					name: workflow.name,
					runCount: count(workflowRun.id),
					lastRunId: max(workflowRun.id),
				})
				.from(workflow)
				.leftJoin(workflowRun, eq(workflow.id, workflowRun.workflowId))
				.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.source, source)))
				.groupBy(workflow.name)
				.orderBy(orderByClause)
				.limit(limit)
				.offset(offset);

			const totalResult = await conn
				.select({ count: sql`count(distinct ${workflow.name})`.mapWith(Number) })
				.from(workflow)
				.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.source, source)));

			return {
				items,
				total: totalResult[0]?.count ?? 0,
			};
		},

		async listVersionsWithStats(
			namespaceId: NamespaceId,
			request: WorkflowListVersionsRequestV1,
			tx?: DbTransaction
		): Promise<{
			items: Array<{ versionId: string; firstSeenAt: Date; lastRunId: string | null; runCount: number }>;
			total: number;
		}> {
			const conn = tx ?? db;

			const { name, source, limit = 50, offset = 0, sort } = request;

			const sortField = sort?.field ?? "firstSeenAt";
			const sortOrder = sort?.order ?? "desc";

			const dir = sql.raw(sortOrder);

			const orderByClause =
				sortField === "firstSeenAt"
					? sql`${workflow.id} ${dir}`
					: (sortField satisfies "runCount") && sql`count(${workflowRun.id}) ${dir}`;

			const items = await conn
				.select({
					versionId: workflow.versionId,
					firstSeenAt: workflow.createdAt,
					lastRunId: max(workflowRun.id),
					runCount: count(workflowRun.id),
				})
				.from(workflow)
				.leftJoin(workflowRun, eq(workflow.id, workflowRun.workflowId))
				.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.source, source), eq(workflow.name, name)))
				.groupBy(workflow.id)
				.orderBy(orderByClause)
				.limit(limit)
				.offset(offset);

			const totalResult = await conn
				.select({ count: count() })
				.from(workflow)
				.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.source, source), eq(workflow.name, name)));

			return {
				items,
				total: totalResult[0]?.count ?? 0,
			};
		},
	};
}

export type WorkflowRepository = ReturnType<typeof createWorkflowRepository>;
