import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { WorkflowSource } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { keysetStreamCursorFilter } from "./lib/keyset-stream";
import type { KeysetStreamCursor } from "../../../../lib/keyset-stream";
import { computeRank, PRIORITY_LEVELS } from "../../../../lib/rank";
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
};
export type WorkflowRunOutboxRowClaimed = WorkflowRunOutboxRow & { status: "claimed"; claimedAt: TimestampMs };

interface ClaimFilter {
	workflows: NonEmptyArray<{ source: WorkflowSource; name: string; versionId: string }>;
	pools?: string[];
}

export const createWorkflowRunOutboxRepository = (db: PgDb) => ({
	async createBatch(rows: NonEmptyArray<WorkflowRunOutboxRowInsert>): Promise<void> {
		await db.insert(workflowRunOutbox).values(rows);
	},

	async deleteByWorkflowRunIds(workflowRunIds: NonEmptyArray<string>): Promise<void> {
		await db.delete(workflowRunOutbox).where(inArray(workflowRunOutbox.workflowRunId, workflowRunIds));
	},

	async listPending(_context: DaemonContext, limit: number): Promise<WorkflowRunOutboxRowPending[]> {
		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(eq(workflowRunOutbox.status, "pending"))
			.orderBy(workflowRunOutbox.nextPublishAttemptRank, workflowRunOutbox.id)
			.limit(limit);

		return rows as WorkflowRunOutboxRowPending[];
	},

	async leaseDuePending(
		_context: DaemonContext,
		params: { leaseDurationMs: number; limit: number }
	): Promise<WorkflowRunOutboxRowPending[]> {
		const { leaseDurationMs, limit } = params;
		const now = Date.now();
		// PRIORITY_LEVELS - 1 is the least priority and produces a rank greater than or equal to any rank due on or before now.
		const maxNextPublishAttemptRank = computeRank({ dueAt: now, priority: PRIORITY_LEVELS - 1 });

		const leaseRankBase = (now + leaseDurationMs) * PRIORITY_LEVELS;

		const duePendingRows = db
			.select({ id: workflowRunOutbox.id })
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.status, "pending"),
					lte(workflowRunOutbox.nextPublishAttemptRank, maxNextPublishAttemptRank)
				)
			)
			.orderBy(workflowRunOutbox.nextPublishAttemptRank, workflowRunOutbox.id)
			.limit(limit);

		const rows = await db
			.update(workflowRunOutbox)
			.set({
				// Each row preserves its priority digit, only the dueAt portion of the rank shifts.
				nextPublishAttemptRank: sql`${leaseRankBase} + (${workflowRunOutbox.rank} - floor(${workflowRunOutbox.rank} / ${PRIORITY_LEVELS}) * ${PRIORITY_LEVELS})`,
			})
			.where(
				and(
					eq(workflowRunOutbox.status, "pending"),
					lte(workflowRunOutbox.nextPublishAttemptRank, maxNextPublishAttemptRank),
					inArray(workflowRunOutbox.id, duePendingRows)
				)
			)
			.returning();

		return rows as WorkflowRunOutboxRowPending[];
	},

	async markPublished(entries: NonEmptyArray<{ id: string; nextPublishAttemptRank: number }>): Promise<void> {
		const now = Date.now() as TimestampMs;

		// Locked in id order so concurrent bulk publishers acquire the same rows the same way.
		const sortedEntries = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
		const valueRows = sortedEntries.map((entry, index) => {
			if (index === 0) {
				return sql`(${entry.id}::text, ${entry.nextPublishAttemptRank}::float8)`;
			}
			return sql`(${entry.id}, ${entry.nextPublishAttemptRank})`;
		});

		await db
			.update(workflowRunOutbox)
			.set({
				status: "published",
				firstPublishedAt: sql`COALESCE(${workflowRunOutbox.firstPublishedAt}, ${new Date(now).toISOString()}::timestamptz)`,
				lastPublishedAt: now,
				nextPublishAttemptRank: sql`v.next_publish_attempt_rank`,
			})
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, next_publish_attempt_rank)`)
			.where(and(eq(workflowRunOutbox.status, "pending"), sql`${workflowRunOutbox.id} = v.id`));
	},

	async setNextPublishAttemptRank(
		entries: NonEmptyArray<{ id: string; nextPublishAttemptRank: number }>
	): Promise<void> {
		// Locked in id order so concurrent bulk publishers acquire the same rows the same way.
		const sortedEntries = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
		const valueRows = sortedEntries.map((entry, index) => {
			if (index === 0) {
				return sql`(${entry.id}::text, ${entry.nextPublishAttemptRank}::float8)`;
			}
			return sql`(${entry.id}, ${entry.nextPublishAttemptRank})`;
		});

		await db
			.update(workflowRunOutbox)
			.set({ nextPublishAttemptRank: sql`v.next_publish_attempt_rank` })
			.from(sql`(VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, next_publish_attempt_rank)`)
			.where(and(eq(workflowRunOutbox.status, "pending"), sql`${workflowRunOutbox.id} = v.id`));
	},

	// firstPublishedAt and lastPublishedAt are not cleared so that backoff anchors survive recovery churn.
	// nextPublishAttemptRank resets to rank so the returned row is immediately due.
	async returnToPending(ids: NonEmptyArray<string>, fromStatus: "claimed" | "published"): Promise<void> {
		await db
			.update(workflowRunOutbox)
			.set({ status: "pending", claimedAt: null, nextPublishAttemptRank: workflowRunOutbox.rank })
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
		// PRIORITY_LEVELS - 1 is the least priority and produces a rank greater than or equal to any rank due on or before now.
		const maxNextPublishAttemptRank = computeRank({ dueAt: Date.now(), priority: PRIORITY_LEVELS - 1 });

		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.status, "published"),
					lte(workflowRunOutbox.nextPublishAttemptRank, maxNextPublishAttemptRank),
					keysetStreamCursorFilter(workflowRunOutbox.nextPublishAttemptRank, workflowRunOutbox.id, cursor)
				)
			)
			.orderBy(workflowRunOutbox.nextPublishAttemptRank, workflowRunOutbox.id)
			.limit(limit);

		return rows as WorkflowRunOutboxRowPublished[];
	},

	async listStaleClaimed(
		_context: DaemonContext,
		params: {
			claimIdleTimeoutMs: number;
			limit: number;
			cursor?: KeysetStreamCursor;
		}
	): Promise<WorkflowRunOutboxRowClaimed[]> {
		const { claimIdleTimeoutMs, limit, cursor } = params;
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

	async listUndeliverable(_context: DaemonContext, params: { maxId: string; limit: number; cursorId?: string }) {
		const { maxId, limit, cursorId } = params;
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

	async getByWorkflowRunId(params: {
		namespaceId: string;
		workflowRunId: string;
	}): Promise<WorkflowRunOutboxRow | null> {
		const result = await db
			.select()
			.from(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.namespaceId, params.namespaceId),
					eq(workflowRunOutbox.workflowRunId, params.workflowRunId)
				)
			)
			.limit(1);

		return result[0] ?? null;
	},

	async deleteByWorkflowRunId(params: { namespaceId: string; workflowRunId: string }): Promise<void> {
		await db
			.delete(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.namespaceId, params.namespaceId),
					eq(workflowRunOutbox.workflowRunId, params.workflowRunId)
				)
			);
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
								eq(workflowRunOutbox.workflowSource, workflow.source),
								eq(workflowRunOutbox.workflowName, workflow.name),
								eq(workflowRunOutbox.workflowVersionId, workflow.versionId)
							)
						)
					),
					isNonEmptyArray(filters.pools)
						? inArray(workflowRunOutbox.pool, filters.pools)
						: isNull(workflowRunOutbox.pool)
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
