import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { keysetStreamCursorFilter } from "./lib/keyset-stream";
import type { KeysetStreamCursor } from "../../../../lib/keyset-stream";
import type { DaemonContext } from "../../../../middleware/context";
import type { PgDb } from "../provider";
import { workflowRunOutbox } from "../schema";

export type WorkflowRunOutboxRow = typeof workflowRunOutbox.$inferSelect;
export type WorkflowRunOutboxRowInsert = typeof workflowRunOutbox.$inferInsert;
export type WorkflowRunOutboxRowInsertPending = WorkflowRunOutboxRowInsert & { status: "pending" };
export type WorkflowRunOutboxRowPending = WorkflowRunOutboxRow & { status: "pending" };
export type WorkflowRunOutboxRowPublished = WorkflowRunOutboxRow & { status: "published"; publishedAt: TimestampMs };
export type WorkflowRunOutboxRowClaimed = WorkflowRunOutboxRow & { status: "claimed"; claimedAt: TimestampMs };

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

export const createWorkflowRunOutboxRepository = (db: PgDb) => ({
	async createBatch(rows: NonEmptyArray<WorkflowRunOutboxRowInsert>): Promise<void> {
		await db.insert(workflowRunOutbox).values(rows);
	},

	async deleteByWorkflowRunIds(workflowRunIds: NonEmptyArray<string>): Promise<void> {
		await db.delete(workflowRunOutbox).where(inArray(workflowRunOutbox.workflowRunId, workflowRunIds));
	},

	async listPending(
		_context: DaemonContext,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<WorkflowRunOutboxRowPending[]> {
		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.status, "pending"),
					keysetStreamCursorFilter(workflowRunOutbox.rank, workflowRunOutbox.id, cursor)
				)
			)
			.orderBy(workflowRunOutbox.rank, workflowRunOutbox.id)
			.limit(limit);

		return rows as WorkflowRunOutboxRowPending[];
	},

	async markPublished(ids: NonEmptyArray<string>): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ status: "published", publishedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.status, "pending"), inArray(workflowRunOutbox.id, ids)));
	},

	async markRepublished(ids: NonEmptyArray<string>): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ publishedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.status, "published"), inArray(workflowRunOutbox.id, ids)));
	},

	async releaseStaleClaim(ids: NonEmptyArray<string>): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ status: "published", claimedAt: null, publishedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.status, "claimed"), inArray(workflowRunOutbox.id, ids)));
	},

	async markClaimed(namespaceId: string, workflowRunId: WorkflowRunId): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ status: "claimed", claimedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)));
	},

	async reclaim(namespaceId: string, workflowRunId: WorkflowRunId): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ claimedAt: Date.now() as TimestampMs })
			.where(
				and(
					eq(workflowRunOutbox.namespaceId, namespaceId),
					eq(workflowRunOutbox.workflowRunId, workflowRunId),
					eq(workflowRunOutbox.status, "claimed")
				)
			);
	},

	async listStalePublished(
		_context: DaemonContext,
		claimMinIdleTimeMs: number,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<WorkflowRunOutboxRowPublished[]> {
		const now = Date.now();
		const staleThreshold = (now - claimMinIdleTimeMs) as TimestampMs;

		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.status, "published"),
					lt(workflowRunOutbox.publishedAt, staleThreshold),
					keysetStreamCursorFilter(workflowRunOutbox.publishedAt, workflowRunOutbox.id, cursor)
				)
			)
			.orderBy(workflowRunOutbox.publishedAt, workflowRunOutbox.id)
			.limit(limit);

		return rows as WorkflowRunOutboxRowPublished[];
	},

	async listStaleClaimed(
		_context: DaemonContext,
		claimMinIdleTimeMs: number,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<WorkflowRunOutboxRowClaimed[]> {
		const now = Date.now();
		const staleThreshold = (now - claimMinIdleTimeMs) as TimestampMs;

		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.status, "claimed"),
					lt(workflowRunOutbox.claimedAt, staleThreshold),
					keysetStreamCursorFilter(workflowRunOutbox.claimedAt, workflowRunOutbox.id, cursor)
				)
			)
			.orderBy(workflowRunOutbox.claimedAt, workflowRunOutbox.id)
			.limit(limit);

		return rows as WorkflowRunOutboxRowClaimed[];
	},

	async listUndeliverable(_context: DaemonContext, maxId: string, limit: number, cursorId?: string) {
		const conditions = [inArray(workflowRunOutbox.status, ["pending", "published"]), lte(workflowRunOutbox.id, maxId)];
		if (cursorId !== undefined) {
			conditions.push(sql`${workflowRunOutbox.id} > ${cursorId}`);
		}

		return db
			.select({
				id: workflowRunOutbox.id,
				workflowRunId: workflowRunOutbox.workflowRunId,
			})
			.from(workflowRunOutbox)
			.where(and(...conditions))
			.orderBy(workflowRunOutbox.id)
			.limit(limit);
	},

	async deleteByWorkflowRunId(namespaceId: string, workflowRunId: string): Promise<void> {
		await db
			.delete(workflowRunOutbox)
			.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)));
	},

	async stealStaleClaimed(namespaceId: string, filters: ClaimFilter, claimMinIdleTimeMs: number, limit: number) {
		const now = Date.now();
		const staleThreshold = (now - claimMinIdleTimeMs) as TimestampMs;

		const staleEntries = await db
			.select({ id: workflowRunOutbox.id })
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.namespaceId, namespaceId),
					eq(workflowRunOutbox.status, "claimed"),
					buildClaimFilterPredicate(filters),
					lt(workflowRunOutbox.claimedAt, staleThreshold)
				)
			)
			.orderBy(workflowRunOutbox.claimedAt, workflowRunOutbox.rank, workflowRunOutbox.id)
			.limit(limit);

		const staleEntryIds = staleEntries.map(({ id }) => id);
		if (!isNonEmptyArray(staleEntryIds)) {
			return [];
		}

		return db
			.update(workflowRunOutbox)
			.set({ claimedAt: now as TimestampMs })
			.where(
				and(
					eq(workflowRunOutbox.status, "claimed"),
					inArray(workflowRunOutbox.id, staleEntryIds),
					lt(workflowRunOutbox.claimedAt, staleThreshold)
				)
			)
			.returning({ workflowRunId: workflowRunOutbox.workflowRunId });
	},

	async claimPublished(namespaceId: string, filters: ClaimFilter, limit: number) {
		const entries = await db
			.select({ id: workflowRunOutbox.id })
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.namespaceId, namespaceId),
					eq(workflowRunOutbox.status, "published"),
					buildClaimFilterPredicate(filters)
				)
			)
			.orderBy(workflowRunOutbox.rank, workflowRunOutbox.id)
			.limit(limit);

		const entryIds = entries.map(({ id }) => id);
		if (!isNonEmptyArray(entryIds)) {
			return [];
		}

		return db
			.update(workflowRunOutbox)
			.set({ status: "claimed", claimedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.status, "published"), inArray(workflowRunOutbox.id, entryIds)))
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
			.set({ status: "claimed", claimedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.status, "pending"), inArray(workflowRunOutbox.id, pendingEntryIds)))
			.returning({ workflowRunId: workflowRunOutbox.workflowRunId });
	},
});

export type WorkflowRunOutboxRepository = ReturnType<typeof createWorkflowRunOutboxRepository>;
