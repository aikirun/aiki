import { streamChunks } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Publisher, ReadyWorkflowRun } from "@aikirun/types/infra/queue";

import type { Repositories } from "../infra/db/types";
import type {
	WorkflowRunOutboxRowInsert,
	WorkflowRunOutboxRowInsertPending,
} from "../infra/db/types/workflow-run-outbox";
import { createRankStreamCursorAdvancer } from "../lib/rank-stream";
import type { DaemonContext } from "../middleware/context";

export interface PublishReadyRunsDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: Publisher;
}

const advanceRankStreamCursor = createRankStreamCursorAdvancer<{ id: string; rank: number }>({
	getRank: (entry) => entry.rank,
	getId: (entry) => entry.id,
});

export async function publishReadyRuns(
	context: DaemonContext,
	deps: PublishReadyRunsDeps,
	{ limit }: { limit: number }
) {
	for await (const pendingEntries of streamChunks(
		(cursor) => deps.repos.workflowRunOutbox.listPending(context, limit, cursor),
		{
			advanceCursor: advanceRankStreamCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		await publishPendingOutboxEntries(context, deps.repos, deps.workflowRunPublisher, pendingEntries);
	}
}

export async function publishPendingOutboxEntries(
	context: DaemonContext,
	repos: Pick<Repositories, "workflowRunOutbox">,
	workflowRunPublisher: Publisher,
	entries: NonEmptyArray<WorkflowRunOutboxRowInsertPending>
): Promise<void> {
	const publishedEntryIds = await publishOutboxEntries(context, workflowRunPublisher, entries);
	if (isNonEmptyArray(publishedEntryIds)) {
		await repos.workflowRunOutbox.markPublished(publishedEntryIds);
	}
}

export async function publishOutboxEntries(
	context: DaemonContext,
	workflowRunPublisher: Publisher,
	entries: NonEmptyArray<WorkflowRunOutboxRowInsert>
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
	if (isNonEmptyArray(result.published)) {
		context.logger.debug("Published ready workflow runs", { "aiki.count": result.published.length });
		for (const run of result.published) {
			const entryId = entryIdByRunId.get(run.id);
			if (entryId !== undefined) {
				publishedEntryIds.push(entryId);
			}
		}
	}

	if (isNonEmptyArray(result.deferred)) {
		context.logger.debug("Deferred publishing workflow runs", { "aiki.count": result.deferred.length });
	}

	if (isNonEmptyArray(result.failed)) {
		context.logger.debug("Failed to publish workflow runs", { "aiki.count": result.failed.length });
	}

	if (isNonEmptyArray(result.declined)) {
		context.logger.warn("Declined to publish workflow runs", { "aiki.count": result.declined.length });
	}

	return publishedEntryIds;
}
