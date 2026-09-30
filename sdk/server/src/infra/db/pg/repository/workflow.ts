import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowListRequestV1, WorkflowListVersionsRequestV1 } from "@aikirun/types/api/workflow";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowSource } from "@aikirun/types/workflow";
import { and, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { DaemonContext } from "../../../../middleware/context";
import { prefixRangeEnd } from "../../lib/prefix-range";
import type { PgDb } from "../provider";
import { workflow } from "../schema";

export type WorkflowRow = typeof workflow.$inferSelect;
export type WorkflowRowInsert = Omit<typeof workflow.$inferInsert, "nameLowercase">;
export type WorkflowIdentity = Pick<WorkflowRow, "namespaceId" | "source" | "name" | "versionId">;

export const createWorkflowRepository = (db: PgDb) => ({
	async getById(namespaceId: NamespaceId, id: string): Promise<WorkflowRow | null> {
		const result = await db
			.select()
			.from(workflow)
			.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.id, id)))
			.limit(1);
		return result[0] ?? null;
	},

	async getByIds(_context: DaemonContext, ids: NonEmptyArray<string>): Promise<WorkflowRow[]> {
		return db.select().from(workflow).where(inArray(workflow.id, ids));
	},

	async getByNameAndVersion(
		namespaceId: NamespaceId,
		filter: { name: string; versionId: string; source: WorkflowSource }
	): Promise<WorkflowRow | null> {
		const result = await db
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

	async listByIdentities(identities: NonEmptyArray<WorkflowIdentity>): Promise<WorkflowRow[]> {
		const rows = identities.map(({ namespaceId, source, name, versionId }, index) => {
			if (index === 0) {
				return sql`(${namespaceId}::text, ${source}::workflow_source, ${name}::text, ${versionId}::text)`;
			}
			return sql`(${namespaceId}, ${source}, ${name}, ${versionId})`;
		});

		// A semi-join, so an identity listed twice still yields its row once.
		return db
			.select()
			.from(workflow)
			.where(
				sql`exists (
					select 1 from (VALUES ${sql.join(rows, sql`, `)}) AS v(namespace_id, source, name, version_id)
					where ${workflow.namespaceId} = v.namespace_id
						and ${workflow.source} = v.source
						and ${workflow.name} = v.name
						and ${workflow.versionId} = v.version_id
				)`
			);
	},

	async createIfMissing(entries: WorkflowRowInsert | NonEmptyArray<WorkflowRowInsert>): Promise<void> {
		await db
			.insert(workflow)
			.values(
				(Array.isArray(entries) ? entries : [entries]).map((entry) => ({
					...entry,
					nameLowercase: entry.name.toLowerCase(),
				}))
			)
			.onConflictDoNothing({ target: [workflow.namespaceId, workflow.source, workflow.name, workflow.versionId] });
	},

	async listByNameAndVersion(
		namespaceId: NamespaceId,
		request: { name: string; versionId?: string; source: WorkflowSource }
	): Promise<WorkflowRow[]> {
		const { name, versionId, source } = request;
		return db
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
		pairs: NonEmptyArray<{ name: string; versionId?: string; source: WorkflowSource }>
	): Promise<WorkflowRow[]> {
		const rows = pairs.map(({ name, versionId, source }, index) => {
			if (index === 0) {
				return sql`(${source}::workflow_source, ${name}::text, ${versionId ?? null}::text)`;
			}
			return sql`(${source}, ${name}, ${versionId ?? null})`;
		});

		// A pair without a version matches every version of that name.
		return db
			.select()
			.from(workflow)
			.where(
				and(
					eq(workflow.namespaceId, namespaceId),
					sql`exists (
						select 1 from (VALUES ${sql.join(rows, sql`, `)}) AS v(source, name, version_id)
						where ${workflow.source} = v.source
							and ${workflow.name} = v.name
							and (v.version_id is null or ${workflow.versionId} = v.version_id)
					)`
				)
			);
	},

	async listNames(
		namespaceId: NamespaceId,
		request: WorkflowListRequestV1
	): Promise<{ items: Array<{ name: string }>; total: number }> {
		const { source, limit = 50, offset = 0, namePrefix } = request;

		const namePrefixCondition = namePrefix !== undefined ? namePrefixMatch(namePrefix) : undefined;
		const whereClause = and(eq(workflow.namespaceId, namespaceId), eq(workflow.source, source), namePrefixCondition);

		const items = await db
			.select({ name: workflow.name })
			.from(workflow)
			.where(whereClause)
			.groupBy(workflow.name)
			.orderBy(workflow.name)
			.limit(limit)
			.offset(offset);

		const totalResult = await db
			.select({ count: sql`count(distinct ${workflow.name})`.mapWith(Number) })
			.from(workflow)
			.where(whereClause);

		return {
			items,
			total: totalResult[0]?.count ?? 0,
		};
	},

	async listVersions(
		namespaceId: NamespaceId,
		request: WorkflowListVersionsRequestV1
	): Promise<{ items: Array<{ versionId: string }>; total: number }> {
		const { name, source, limit = 50, offset = 0 } = request;

		const whereClause = and(
			eq(workflow.namespaceId, namespaceId),
			eq(workflow.source, source),
			eq(workflow.name, name)
		);

		// Newest version first: ids are ulids, so id order is creation order.
		const items = await db
			.select({ versionId: workflow.versionId })
			.from(workflow)
			.where(whereClause)
			.orderBy(desc(workflow.id))
			.limit(limit)
			.offset(offset);

		const totalResult = await db.select({ count: count() }).from(workflow).where(whereClause);

		return {
			items,
			total: totalResult[0]?.count ?? 0,
		};
	},
});

export type WorkflowRepository = ReturnType<typeof createWorkflowRepository>;

// Every name starting with the prefix sorts between the prefix and prefixRangeEnd(prefix), so the
// match is one range read of idx_workflow_namespace_source_name_lowercase. LIKE reads that range only
// when Postgres plans the query knowing the prefix, which a prepared statement does not guarantee.
// The range holds only in code point order, hence the "C" collation on the index and on these comparisons.
function namePrefixMatch(namePrefix: string): SQL {
	const namePrefixLowercase = namePrefix.toLowerCase();
	const rangeStart = sql`${workflow.nameLowercase} COLLATE "C" >= ${namePrefixLowercase}`;
	const rangeEnd = prefixRangeEnd(namePrefixLowercase);
	if (rangeEnd === undefined) {
		return rangeStart;
	}
	return sql`${rangeStart} AND ${workflow.nameLowercase} COLLATE "C" < ${rangeEnd}`;
}
