import { asNonEmptyArray, isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { keysetStreamCursorFilter } from "./lib/keyset-stream";
import { valuesTable } from "./lib/values-table";
import { computeRank, PRIORITY_LEVELS } from "../../../../lib/rank";
import type {
	WorkflowRunOutboxRepository,
	WorkflowRunOutboxRowClaimed,
	WorkflowRunOutboxRowPending,
	WorkflowRunOutboxRowPublished,
} from "../../types/workflow-run-outbox";
import type { SqliteDb } from "../provider";
import { workflowRunOutbox } from "../schema";

export const createWorkflowRunOutboxRepository = (db: SqliteDb): WorkflowRunOutboxRepository => ({
	async createBatch(rows) {
		await db.insert(workflowRunOutbox).values(rows);
	},

	async deleteByWorkflowRunIds(workflowRunIds) {
		await db.delete(workflowRunOutbox).where(inArray(workflowRunOutbox.workflowRunId, workflowRunIds));
	},

	async listPending(_context, limit) {
		const rows = await db
			.select()
			.from(workflowRunOutbox)
			.where(eq(workflowRunOutbox.status, "pending"))
			.orderBy(workflowRunOutbox.nextPublishAttemptRank, workflowRunOutbox.id)
			.limit(limit);

		return rows as WorkflowRunOutboxRowPending[];
	},

	async leaseDuePending(_context, params) {
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

	async markPublished(entries) {
		const now = Date.now() as TimestampMs;
		const valueRows = asNonEmptyArray(entries.map((entry) => sql`(${entry.id}, ${entry.nextPublishAttemptRank})`));

		await db
			.update(workflowRunOutbox)
			.set({
				status: "published",
				firstPublishedAt: sql`COALESCE(${workflowRunOutbox.firstPublishedAt}, ${now})`,
				lastPublishedAt: now,
				nextPublishAttemptRank: sql`v.next_publish_attempt_rank`,
			})
			.from(valuesTable("v", ["id", "next_publish_attempt_rank"], valueRows))
			.where(and(eq(workflowRunOutbox.status, "pending"), sql`${workflowRunOutbox.id} = v.id`));
	},

	async setNextPublishAttemptRank(entries) {
		const valueRows = asNonEmptyArray(entries.map((entry) => sql`(${entry.id}, ${entry.nextPublishAttemptRank})`));

		await db
			.update(workflowRunOutbox)
			.set({ nextPublishAttemptRank: sql`v.next_publish_attempt_rank` })
			.from(valuesTable("v", ["id", "next_publish_attempt_rank"], valueRows))
			.where(and(eq(workflowRunOutbox.status, "pending"), sql`${workflowRunOutbox.id} = v.id`));
	},

	// firstPublishedAt and lastPublishedAt are not cleared so that backoff anchors survive recovery churn.
	// nextPublishAttemptRank resets to rank so the returned row is immediately due.
	async returnToPending(ids, fromStatus) {
		await db
			.update(workflowRunOutbox)
			.set({ status: "pending", claimedAt: null, nextPublishAttemptRank: workflowRunOutbox.rank })
			.where(and(inArray(workflowRunOutbox.id, ids), eq(workflowRunOutbox.status, fromStatus)));
	},

	async markClaimed(namespaceId, workflowRunId) {
		await db
			.update(workflowRunOutbox)
			.set({ status: "claimed", claimedAt: Date.now() as TimestampMs })
			.where(and(eq(workflowRunOutbox.namespaceId, namespaceId), eq(workflowRunOutbox.workflowRunId, workflowRunId)));
	},

	async refreshClaim(namespaceId, workflowRunId) {
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

	async listDueForRepublish(_context, params) {
		const { limit, cursor } = params;
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

	async listStaleClaimed(_context, params) {
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

	async listUndeliverable(_context, params) {
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

	async getByWorkflowRunId(params) {
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

	async deleteByWorkflowRunId(params) {
		await db
			.delete(workflowRunOutbox)
			.where(
				and(
					eq(workflowRunOutbox.namespaceId, params.namespaceId),
					eq(workflowRunOutbox.workflowRunId, params.workflowRunId)
				)
			);
	},

	async claimPending(namespaceId, filters, limit) {
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
