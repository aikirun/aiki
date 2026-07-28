import { streamChunks } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher, ReadyWorkflowRun } from "@aikirun/types/infra/queue";

import type { Repositories } from "../infra/db/types";
import type { WorkflowRunOutboxRowInsertPending } from "../infra/db/types/workflow-run-outbox";
import { createKeysetStreamCursorAdvancer } from "../lib/keyset-stream";
import type { DaemonContext } from "../middleware/context";

export interface PublishReadyRunsDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: Publisher;
}

export interface RepublishBackoff {
	baseDelayMs: number;
	maxDelayMs: number;
}

export interface PublishReadyRunsConfig {
	limit: number;
	republishBackoff: RepublishBackoff;
}

const PUBLISH_OUTCOMES = ["published", "deferred", "failed", "declined"] as const;

const advanceOutboxCursor = createKeysetStreamCursorAdvancer<{ rank: number; id: string }>({
	getOrder: (entry) => entry.rank,
	getId: (entry) => entry.id,
});

export async function publishReadyRuns(
	context: DaemonContext,
	{ repos, workflowRunPublisher }: PublishReadyRunsDeps,
	{ limit, republishBackoff }: PublishReadyRunsConfig
) {
	for await (const pendingEntries of streamChunks(
		(cursor) => repos.workflowRunOutbox.listPending(context, limit, cursor),
		{
			advanceCursor: advanceOutboxCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		await publishPendingOutboxEntries(context, repos, workflowRunPublisher, pendingEntries, republishBackoff);
	}
}

export async function publishPendingOutboxEntries(
	context: DaemonContext,
	repos: Pick<Repositories, "workflowRunOutbox">,
	workflowRunPublisher: Publisher,
	entries: NonEmptyArray<WorkflowRunOutboxRowInsertPending>,
	{ baseDelayMs, maxDelayMs }: RepublishBackoff
): Promise<void> {
	const publishedEntryIds = await publishOutboxEntries(context, workflowRunPublisher, entries);
	if (isNonEmptyArray(publishedEntryIds)) {
		const now = Date.now();
		const initialBackoffMs = now + Math.min(baseDelayMs, maxDelayMs);
		const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

		const entriesToMarkPublished = publishedEntryIds.map((id) => {
			const firstPublishedAt = entriesById.get(id)?.firstPublishedAt;
			if (firstPublishedAt === null || firstPublishedAt === undefined) {
				return { id, nextPublishAttemptAt: initialBackoffMs };
			}
			return {
				id,
				nextPublishAttemptAt: computeRepublishBackoff({ now, firstPublishedAt, baseDelayMs, maxDelayMs }),
			};
		}) as NonEmptyArray<{ id: string; nextPublishAttemptAt: TimestampMs }>;

		await repos.workflowRunOutbox.markPublished(entriesToMarkPublished);
	}
}

/**
 * Backoff interval before the next republish attempt.
 * backoff = now + age; this doubles the waiting period on each attempt.
 * The backoff is clamped to [baseDelayMs, maxDelayMs].
 */
export function computeRepublishBackoff(params: {
	now: number;
	firstPublishedAt: number;
	baseDelayMs: number;
	maxDelayMs: number;
}): number {
	const { now, firstPublishedAt, baseDelayMs, maxDelayMs } = params;
	const ageMs = now - firstPublishedAt;
	const backoffMs = Math.min(Math.max(ageMs, baseDelayMs), maxDelayMs);
	return now + backoffMs;
}

async function publishOutboxEntries(
	{ logger }: DaemonContext,
	workflowRunPublisher: Publisher,
	entries: NonEmptyArray<WorkflowRunOutboxRowInsertPending>
): Promise<string[]> {
	const entryIdByRunId = new Map<string, string>();
	const runs: ReadyWorkflowRun[] = [];
	for (const entry of entries) {
		entryIdByRunId.set(entry.workflowRunId, entry.id);
		runs.push({
			namespaceId: entry.namespaceId,
			id: entry.workflowRunId,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			rank: entry.rank,
			shard: entry.shard ?? undefined,
		});
	}

	const result = await workflowRunPublisher.publishReadyRuns(runs as NonEmptyArray<ReadyWorkflowRun>);

	const publishedEntryIds: string[] = [];

	for (const outcome of PUBLISH_OUTCOMES) {
		const bucket = result[outcome];
		if (!isNonEmptyArray(bucket)) {
			continue;
		}

		switch (outcome) {
			case "published":
				logger.debug("Published ready workflow runs", { "aiki.count": bucket.length });
				for (const { run } of bucket) {
					const entryId = entryIdByRunId.get(run.id);
					if (entryId !== undefined) {
						publishedEntryIds.push(entryId);
					}
				}
				break;
			case "deferred":
				logger.debug("Deferred publishing workflow runs", { "aiki.count": bucket.length });
				break;
			case "failed":
				logger.debug("Failed to publish workflow runs", { "aiki.count": bucket.length });
				break;
			case "declined":
				logger.warn("Declined to publish workflow runs", { "aiki.count": bucket.length });
				break;
			default:
				outcome satisfies never;
		}
	}

	return publishedEntryIds;
}
