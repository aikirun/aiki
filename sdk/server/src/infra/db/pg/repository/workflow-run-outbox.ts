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
export type WorkflowRunOutboxRowPublished = WorkflowRunOutboxRow & {
	status: "published";
	firstPublishedAt: TimestampMs;
	lastPublishedAt: TimestampMs;
	nextPublishAttemptAt: TimestampMs;
};
export type WorkflowRunOutboxRowClaimed = WorkflowRunOutboxRow & { status: "claimed"; claimedAt: TimestampMs };

interface ClaimFilter {
	workflows: NonEmptyArray<{ name: string; versionId: string }>;
	shards?: string[];
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

	async markPublished(entries: NonEmptyArray<{ id: string; nextPublishAttemptAt: TimestampMs }>): Promise<void> {
		const now = Date.now() as TimestampMs;

		const valueRows = entries.map((entry, index) => {
			if (index === 0) {
				return sql`(${entry.id}::text, ${new Date(entry.nextPublishAttemptAt).toISOString()}::timestamptz)`;
			}
			return sql`(${entry.id}, ${new Date(entry.nextPublishAttemptAt).toISOString()})`;
		});

		await db
			.update(workflowRunOutbox)
			.set({
				status: "published",
				firstPublishedAt: sql`COALESCE(${workflowRunOutbox.firstPublishedAt}, ${new Date(now).toISOString()}::timestamptz)`,
				lastPublishedAt: now,
				nextPublishAttemptAt: sql`v.next_publish_attempt_at`,
			})
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, next_publish_attempt_at)`)
			.where(and(eq(workflowRunOutbox.status, "pending"), sql`${workflowRunOutbox.id} = v.id`));
	},

	// firstPublishedAt and lastPublishedAt are not cleared so that backoff anchors survive recovery churn.
	async returnToPending(ids: NonEmptyArray<string>, fromStatus: "claimed" | "published"): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ status: "pending", claimedAt: null, nextPublishAttemptAt: null })
			.where(and(inArray(workflowRunOutbox.id, ids), eq(workflowRunOutbox.status, fromStatus)));
	},

	async markClaimed(namespaceId: string, workflowRunId: WorkflowRunId): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ status: "claimed", claimedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)));
	},

	async refreshClaim(namespaceId: string, workflowRunId: WorkflowRunId): Promise<void> {
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

	async listPublishable(
		_context: DaemonContext,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<WorkflowRunOutboxRowPublished[]> {
		const now = Date.now() as TimestampMs;

		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.status, "published"),
					lte(workflowRunOutbox.nextPublishAttemptAt, now),
					keysetStreamCursorFilter(workflowRunOutbox.nextPublishAttemptAt, workflowRunOutbox.id, cursor)
				)
			)
			.orderBy(workflowRunOutbox.nextPublishAttemptAt, workflowRunOutbox.id)
			.limit(limit);

		return rows as WorkflowRunOutboxRowPublished[];
	},

	async listStaleClaimed(
		_context: DaemonContext,
		claimIdleTimeoutMs: number,
		limit: number,
		cursor?: KeysetStreamCursor
	): Promise<WorkflowRunOutboxRowClaimed[]> {
		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.status, "claimed"),
					lt(workflowRunOutbox.claimedAt, (Date.now() - claimIdleTimeoutMs) as TimestampMs),
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

	async getByWorkflowRunId(namespaceId: string, workflowRunId: string): Promise<WorkflowRunOutboxRow | null> {
		const result = await db
			.select()
			.from(workflowRunOutbox)
			.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)))
			.limit(1);

		return result[0] ?? null;
	},

	async deleteByWorkflowRunId(namespaceId: string, workflowRunId: string): Promise<void> {
		await db
			.delete(workflowRunOutbox)
			.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)));
	},

	async claimPending(namespaceId: string, filters: ClaimFilter, limit: number) {
		const claimableEntryIds = db
			.select({ id: workflowRunOutbox.id })
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.namespaceId, namespaceId),
					eq(workflowRunOutbox.status, "pending"),
					or(
						...filters.workflows.map((workflow) =>
							and(
								eq(workflowRunOutbox.workflowName, workflow.name),
								eq(workflowRunOutbox.workflowVersionId, workflow.versionId)
							)
						)
					),
					isNonEmptyArray(filters.shards)
						? inArray(workflowRunOutbox.shard, filters.shards)
						: isNull(workflowRunOutbox.shard)
				)
			)
			.orderBy(workflowRunOutbox.rank, workflowRunOutbox.id)
			.limit(limit);

		return db
			.update(workflowRunOutbox)
			.set({ status: "claimed", claimedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.status, "pending"), inArray(workflowRunOutbox.id, claimableEntryIds)))
			.returning({ workflowRunId: workflowRunOutbox.workflowRunId });
	},
});

export type WorkflowRunOutboxRepository = ReturnType<typeof createWorkflowRunOutboxRepository>;
