import { streamChunks } from "@aikirun/lib/async";
import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type { Publisher, PublishRunsResult, ReadyWorkflowRun } from "@aikirun/types/infra/queue";

import type { PageProcessingConfig } from "../config/runtime";
import type { Repositories } from "../infra/db/types";
import type {
	WorkflowRunOutboxRowInsertPending,
	WorkflowRunOutboxRowPending,
} from "../infra/db/types/workflow-run-outbox";
import { runConcurrently } from "../lib/concurrency";
import { computeRank, extractRankPriority } from "../lib/rank";
import type { DaemonContext } from "../middleware/context";

export interface PublishPendingOutboxEntriesDeps {
	repos: Repositories;
	publisher: Publisher;
}

export interface RepublishBackoff {
	baseDelayMs: number;
	maxDelayMs: number;
	declinedBackoffMs: number;
}

export type PublishPendingOutboxEntriesConfig = PageProcessingConfig & {
	leaseDurationMs: number;
	republishBackoff: RepublishBackoff;
};

const PUBLISH_OUTCOMES = ["published", "deferred", "failed", "declined"] as const;
declare const _publishOutcomeTypeTest: [ExpectTrue<Equal<(typeof PUBLISH_OUTCOMES)[number], keyof PublishRunsResult>>];

export async function publishPendingOutboxEntries(
	context: DaemonContext,
	{ repos, publisher }: PublishPendingOutboxEntriesDeps,
	{ pageSize, chunk, leaseDurationMs, republishBackoff }: PublishPendingOutboxEntriesConfig
) {
	for await (const pendingEntries of streamChunks(
		() => repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs, limit: pageSize }),
		{ until: (page) => page.length < pageSize }
	)) {
		await runConcurrently(
			context,
			chunkLazy(pendingEntries, chunk.size),
			async (entriesChunk, spanCtx) => {
				await publishOutboxEntries(spanCtx, repos, publisher, entriesChunk, republishBackoff);
			},
			{ concurrency: chunk.maxConcurrency }
		);
	}
}

export async function publishOutboxEntries(
	{ logger }: DaemonContext,
	repos: Repositories,
	publisher: Publisher,
	entries: NonEmptyArray<WorkflowRunOutboxRowPending | WorkflowRunOutboxRowInsertPending>,
	republishBackoff: RepublishBackoff
) {
	const entryByRunId = new Map<string, WorkflowRunOutboxRowPending | WorkflowRunOutboxRowInsertPending>();
	const runs: ReadyWorkflowRun[] = [];
	for (const entry of entries) {
		entryByRunId.set(entry.workflowRunId, entry);
		runs.push({
			namespaceId: entry.namespaceId,
			id: entry.workflowRunId,
			source: entry.workflowSource,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			rank: entry.rank,
			pool: entry.pool ?? undefined,
		});
	}

	const result = await publisher.publishRuns(runs as NonEmptyArray<ReadyWorkflowRun>);

	const now = Date.now();
	const { baseDelayMs, maxDelayMs, declinedBackoffMs } = republishBackoff;

	const publishedEntries: Array<{ id: string; nextPublishAttemptRank: number }> = [];
	const nonPublishedEntries: Array<{ id: string; nextPublishAttemptRank: number }> = [];

	for (const outcome of PUBLISH_OUTCOMES) {
		switch (outcome) {
			case "published": {
				const publishedRuns = result.published?.runs;
				if (!isNonEmptyArray(publishedRuns)) {
					break;
				}
				logger.debug("Published ready workflow runs", { "aiki.count": publishedRuns.length });

				for (const { run } of publishedRuns) {
					const entry = entryByRunId.get(run.id);
					if (!entry) {
						continue;
					}

					const backoffMs = computeRepublishBackoffMs({
						now,
						initialAttemptAt: entry.firstPublishedAt ?? now,
						baseDelayMs,
						maxDelayMs,
					});
					publishedEntries.push({
						id: entry.id,
						nextPublishAttemptRank: computeRank({
							dueAt: now + backoffMs,
							priority: extractRankPriority(entry.rank),
						}),
					});
				}
				break;
			}
			case "deferred": {
				const publishDeferredRuns = result.deferred?.runs;
				if (!isNonEmptyArray(publishDeferredRuns)) {
					break;
				}
				logger.debug("Deferred publishing workflow runs", { "aiki.count": publishDeferredRuns.length });

				for (const { run, nextPublishAttemptAt } of publishDeferredRuns) {
					const entry = entryByRunId.get(run.id);
					if (!entry) {
						continue;
					}

					nonPublishedEntries.push({
						id: entry.id,
						nextPublishAttemptRank: computeRank({
							dueAt: nextPublishAttemptAt,
							priority: extractRankPriority(entry.rank),
						}),
					});
				}
				break;
			}
			case "failed": {
				const publishFailedRuns = result.failed?.runs;
				if (!isNonEmptyArray(publishFailedRuns)) {
					break;
				}
				logger.debug("Failed to publish workflow runs", { "aiki.count": publishFailedRuns.length });

				for (const { run } of publishFailedRuns) {
					const entry = entryByRunId.get(run.id);
					if (!entry) {
						continue;
					}

					const backoffMs = computeRepublishBackoffMs({
						now,
						// maintain the backoff curve if the entry was previously published, but now failing.
						// otherwise, anchor age off createdAt; insert rows from the inline publish path
						// carry no createdAt and fall back to now.
						initialAttemptAt: entry.firstPublishedAt ?? entry.createdAt ?? now,
						baseDelayMs,
						maxDelayMs,
					});
					nonPublishedEntries.push({
						id: entry.id,
						nextPublishAttemptRank: computeRank({
							dueAt: now + backoffMs,
							priority: extractRankPriority(entry.rank),
						}),
					});
				}
				break;
			}
			case "declined": {
				const publishDeclinedRuns = result.declined?.runs;
				if (!isNonEmptyArray(publishDeclinedRuns)) {
					break;
				}
				logger.warn("Declined to publish workflow runs", { "aiki.count": publishDeclinedRuns.length });

				for (const { run } of publishDeclinedRuns) {
					const entry = entryByRunId.get(run.id);
					if (!entry) {
						continue;
					}

					nonPublishedEntries.push({
						id: entry.id,
						nextPublishAttemptRank: computeRank({
							dueAt: now + declinedBackoffMs,
							priority: extractRankPriority(entry.rank),
						}),
					});
				}
				break;
			}
			default: {
				outcome satisfies never;
			}
		}
	}

	if (isNonEmptyArray(publishedEntries)) {
		await repos.workflowRunOutbox.markPublished(publishedEntries);
	}

	if (isNonEmptyArray(nonPublishedEntries)) {
		await repos.workflowRunOutbox.setNextPublishAttemptRank(nonPublishedEntries);
	}
}

/**
 * Backoff interval before the next republish attempt.
 * backoff = durationSinceInitialAttemtMs; this doubles the waiting period on each attempt.
 * The backoff is clamped to [baseDelayMs, maxDelayMs].
 */
export function computeRepublishBackoffMs(params: {
	now: number;
	initialAttemptAt: number;
	baseDelayMs: number;
	maxDelayMs: number;
}): number {
	const { now, initialAttemptAt, baseDelayMs, maxDelayMs } = params;
	const durationSinceInitialAttemtMs = now - initialAttemptAt;
	return Math.min(Math.max(durationSinceInitialAttemtMs, baseDelayMs), maxDelayMs);
}
