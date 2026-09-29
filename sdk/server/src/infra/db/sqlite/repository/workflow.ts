import { asNonEmptyArray } from "@aikirun/lib/collection/array";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { valuesTable } from "./lib/values-table";
import type { WorkflowRepository } from "../../types/workflow";
import type { SqliteDb } from "../provider";
import { workflow } from "../schema";

export const createWorkflowRepository = (db: SqliteDb): WorkflowRepository => ({
	async getById(namespaceId, id) {
		const result = await db
			.select()
			.from(workflow)
			.where(and(eq(workflow.namespaceId, namespaceId), eq(workflow.id, id)))
			.limit(1);
		return result[0] ?? null;
	},

	async getByIds(_context, ids) {
		return db.select().from(workflow).where(inArray(workflow.id, ids));
	},

	async getByNameAndVersion(namespaceId, filter) {
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

	async listByIdentities(identities) {
		const rows = asNonEmptyArray(
			identities.map(
				({ namespaceId, source, name, versionId }) => sql`(${namespaceId}, ${source}, ${name}, ${versionId})`
			)
		);

		// A semi-join, so an identity listed twice still yields its row once.
		return db
			.select()
			.from(workflow)
			.where(
				sql`exists (
					select 1 from ${valuesTable("v", ["namespace_id", "source", "name", "version_id"], rows)}
					where ${workflow.namespaceId} = v.namespace_id
						and ${workflow.source} = v.source
						and ${workflow.name} = v.name
						and ${workflow.versionId} = v.version_id
				)`
			);
	},

	async createIfMissing(entries) {
		await db
			.insert(workflow)
			.values(Array.isArray(entries) ? entries : [entries])
			.onConflictDoNothing({ target: [workflow.namespaceId, workflow.source, workflow.name, workflow.versionId] });
	},

	async listByNameAndVersion(namespaceId, request) {
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

	async listByNameAndVersionPairs(namespaceId, pairs) {
		const rows = asNonEmptyArray(
			pairs.map(({ name, versionId, source }) => sql`(${source}, ${name}, ${versionId ?? null})`)
		);

		// A pair without a version matches every version of that name.
		return db
			.select()
			.from(workflow)
			.where(
				and(
					eq(workflow.namespaceId, namespaceId),
					sql`exists (
						select 1 from ${valuesTable("v", ["source", "name", "version_id"], rows)}
						where ${workflow.source} = v.source
							and ${workflow.name} = v.name
							and (v.version_id is null or ${workflow.versionId} = v.version_id)
					)`
				)
			);
	},

	async listNames(namespaceId, request) {
		const { source, limit = 50, offset = 0, namePrefix } = request;

		// Not LIKE: SQLite's LIKE ignores ASCII case.
		const namePrefixCondition =
			namePrefix !== undefined ? sql`substr(${workflow.name}, 1, length(${namePrefix})) = ${namePrefix}` : undefined;
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

	async listVersions(namespaceId, request) {
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
