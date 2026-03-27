import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

import type { SqliteDb } from "../provider";
import { workflowRunOutbox } from "../schema";

export type WorkflowRunOutboxRow = typeof workflowRunOutbox.$inferSelect;
export type WorkflowRunOutboxRowInsert = typeof workflowRunOutbox.$inferInsert;

export function createWorkflowRunOutboxRepository(db: SqliteDb) {
	return {
		async createBatch(rows: NonEmptyArray<WorkflowRunOutboxRowInsert>): Promise<void> {
			await db.insert(workflowRunOutbox).values(rows);
		},

		async listPending(limit = 100): Promise<WorkflowRunOutboxRow[]> {
			return db
				.select()
				.from(workflowRunOutbox)
				.where(eq(workflowRunOutbox.status, "pending"))
				.orderBy(workflowRunOutbox.createdAt)
				.limit(limit);
		},

		async markPublished(ids: NonEmptyArray<string>): Promise<void> {
			await db
				.update(workflowRunOutbox)
				.set({ status: "published" })
				.where(and(eq(workflowRunOutbox.status, "pending"), inArray(workflowRunOutbox.id, ids)));
		},

		async markAsRepublished(ids: NonEmptyArray<string>): Promise<void> {
			await db
				.update(workflowRunOutbox)
				.set({ updatedAt: new Date() })
				.where(and(eq(workflowRunOutbox.status, "published"), inArray(workflowRunOutbox.id, ids)));
		},

		async listStalePublished(claimMinIdleTimeMs: number, limit: number): Promise<WorkflowRunOutboxRow[]> {
			const now = Date.now();
			const staleThreshold = new Date(now - claimMinIdleTimeMs);

			return db
				.select()
				.from(workflowRunOutbox)
				.where(and(eq(workflowRunOutbox.status, "published"), lt(workflowRunOutbox.updatedAt, staleThreshold)))
				.orderBy(workflowRunOutbox.updatedAt)
				.limit(limit);
		},

		async deleteByWorkflowRunId(namespaceId: string, workflowRunId: string): Promise<void> {
			await db
				.delete(workflowRunOutbox)
				.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)));
		},

		async claimStalePublished(
			namespaceId: string,
			filters: NonEmptyArray<{ name: string; versionId: string; shard?: string }>,
			claimMinIdleTimeMs: number,
			limit: number
		) {
			const now = Date.now();
			const staleThreshold = new Date(now - claimMinIdleTimeMs);

			const workflowsFilter = filters.map((filter) =>
				filter.shard !== undefined
					? and(
							eq(workflowRunOutbox.workflowName, filter.name),
							eq(workflowRunOutbox.workflowVersionId, filter.versionId),
							eq(workflowRunOutbox.shard, filter.shard)
						)
					: and(
							eq(workflowRunOutbox.workflowName, filter.name),
							eq(workflowRunOutbox.workflowVersionId, filter.versionId)
						)
			);

			const staleEntries = await db
				.select({ id: workflowRunOutbox.id })
				.from(workflowRunOutbox)
				.where(
					and(
						eq(workflowRunOutbox.namespaceId, namespaceId),
						eq(workflowRunOutbox.status, "published"),
						lt(workflowRunOutbox.updatedAt, staleThreshold),
						workflowsFilter.length === 1 ? workflowsFilter[0] : sql`(${sql.join(workflowsFilter, sql` OR `)})`
					)
				)
				.orderBy(workflowRunOutbox.updatedAt)
				.limit(limit);

			const staleEntryIds = staleEntries.map(({ id }) => id);
			if (!isNonEmptyArray(staleEntryIds)) {
				return [];
			}

			return db
				.update(workflowRunOutbox)
				.set({ updatedAt: new Date(now) })
				.where(
					and(
						eq(workflowRunOutbox.status, "published"),
						inArray(workflowRunOutbox.id, staleEntryIds),
						lt(workflowRunOutbox.updatedAt, staleThreshold)
					)
				)
				.returning({ workflowRunId: workflowRunOutbox.workflowRunId });
		},

		async claimPending(
			namespaceId: string,
			filters: NonEmptyArray<{ name: string; versionId: string; shard?: string }>,
			limit: number
		) {
			const workflowsFilter = filters.map((filter) =>
				filter.shard !== undefined
					? and(
							eq(workflowRunOutbox.workflowName, filter.name),
							eq(workflowRunOutbox.workflowVersionId, filter.versionId),
							eq(workflowRunOutbox.shard, filter.shard)
						)
					: and(
							eq(workflowRunOutbox.workflowName, filter.name),
							eq(workflowRunOutbox.workflowVersionId, filter.versionId)
						)
			);

			const pendingEntries = await db
				.select({ id: workflowRunOutbox.id })
				.from(workflowRunOutbox)
				.where(
					and(
						eq(workflowRunOutbox.namespaceId, namespaceId),
						eq(workflowRunOutbox.status, "pending"),
						workflowsFilter.length === 1 ? workflowsFilter[0] : sql`(${sql.join(workflowsFilter, sql` OR `)})`
					)
				)
				.orderBy(workflowRunOutbox.createdAt)
				.limit(limit);

			const pendingEntryIds = pendingEntries.map(({ id }) => id);
			if (!isNonEmptyArray(pendingEntryIds)) {
				return [];
			}

			return db
				.update(workflowRunOutbox)
				.set({ status: "published" })
				.where(and(eq(workflowRunOutbox.status, "pending"), inArray(workflowRunOutbox.id, pendingEntryIds)))
				.returning({ workflowRunId: workflowRunOutbox.workflowRunId });
		},

		async reclaim(namespaceId: string, workflowRunId: WorkflowRunId): Promise<void> {
			await db
				.update(workflowRunOutbox)
				.set({ updatedAt: new Date() })
				.where(
					and(
						eq(workflowRunOutbox.namespaceId, namespaceId),
						eq(workflowRunOutbox.workflowRunId, workflowRunId),
						eq(workflowRunOutbox.status, "published")
					)
				);
		},
	};
}

export type WorkflowRunOutboxRepository = ReturnType<typeof createWorkflowRunOutboxRepository>;
