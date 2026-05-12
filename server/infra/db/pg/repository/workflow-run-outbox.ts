import type { NonEmptyArray } from "@aikirun/lib/array";
import { isNonEmptyArray } from "@aikirun/lib/array";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { RankStreamCursor } from "server/daemons/lib/rank-stream";
import type { TimerStreamCursor } from "server/daemons/lib/timer-stream";
import type { DaemonContext } from "server/middleware/context";

import { rankStreamCursorFilter } from "./lib/rank-stream";
import { timerStreamCursorFilter } from "./lib/timer-stream";
import type { PgDb } from "../provider";
import { workflowRunOutbox } from "../schema";

export type WorkflowRunOutboxRow = typeof workflowRunOutbox.$inferSelect;
export type WorkflowRunOutboxRowInsert = typeof workflowRunOutbox.$inferInsert;

interface ClaimFilter {
	workflows: NonEmptyArray<{ name: string; versionId: string }>;
	shards?: string[];
}

function buildClaimFilterPredicate(filters: ClaimFilter) {
	const workflowsPredicate = or(
		...filters.workflows.map((workflow) =>
			and(
				eq(workflowRunOutbox.workflowName, workflow.name),
				eq(workflowRunOutbox.workflowVersionId, workflow.versionId)
			)
		)
	);
	const shardsPredicate = isNonEmptyArray(filters.shards)
		? inArray(workflowRunOutbox.shard, filters.shards)
		: isNull(workflowRunOutbox.shard);

	return and(workflowsPredicate, shardsPredicate);
}

export function createWorkflowRunOutboxRepository(db: PgDb) {
	return {
		async createBatch(rows: NonEmptyArray<WorkflowRunOutboxRowInsert>): Promise<void> {
			await db.insert(workflowRunOutbox).values(rows);
		},

		async listPending(
			_context: DaemonContext,
			limit: number,
			cursor?: RankStreamCursor
		): Promise<WorkflowRunOutboxRow[]> {
			return db
				.select()
				.from(workflowRunOutbox)
				.where(
					and(
						eq(workflowRunOutbox.status, "pending"),
						rankStreamCursorFilter(workflowRunOutbox.rank, workflowRunOutbox.id, cursor)
					)
				)
				.orderBy(workflowRunOutbox.rank, workflowRunOutbox.id)
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

		async listStalePublished(
			_context: DaemonContext,
			claimMinIdleTimeMs: number,
			limit: number,
			cursor?: TimerStreamCursor
		): Promise<WorkflowRunOutboxRow[]> {
			const now = Date.now();
			const staleThreshold = new Date(now - claimMinIdleTimeMs);

			return db
				.select()
				.from(workflowRunOutbox)
				.where(
					and(
						eq(workflowRunOutbox.status, "published"),
						lt(workflowRunOutbox.updatedAt, staleThreshold),
						timerStreamCursorFilter(workflowRunOutbox.updatedAt, workflowRunOutbox.id, cursor)
					)
				)
				.orderBy(workflowRunOutbox.updatedAt, workflowRunOutbox.id)
				.limit(limit);
		},

		async deleteByWorkflowRunId(namespaceId: string, workflowRunId: string): Promise<void> {
			await db
				.delete(workflowRunOutbox)
				.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)));
		},

		async claimStalePublished(namespaceId: string, filters: ClaimFilter, claimMinIdleTimeMs: number, limit: number) {
			const now = Date.now();
			const staleThreshold = new Date(now - claimMinIdleTimeMs);

			const staleEntries = await db
				.select({ id: workflowRunOutbox.id })
				.from(workflowRunOutbox)
				.where(
					and(
						eq(workflowRunOutbox.namespaceId, namespaceId),
						eq(workflowRunOutbox.status, "published"),
						lt(workflowRunOutbox.updatedAt, staleThreshold),
						buildClaimFilterPredicate(filters)
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

		async claimPending(namespaceId: string, filters: ClaimFilter, limit: number) {
			const pendingEntries = await db
				.select({ id: workflowRunOutbox.id })
				.from(workflowRunOutbox)
				.where(
					and(
						eq(workflowRunOutbox.namespaceId, namespaceId),
						eq(workflowRunOutbox.status, "pending"),
						buildClaimFilterPredicate(filters)
					)
				)
				.orderBy(workflowRunOutbox.rank, workflowRunOutbox.id)
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
