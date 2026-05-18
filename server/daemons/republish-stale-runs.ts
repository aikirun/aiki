import type { NonEmptyArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";
import type { Publisher, WorkflowRunReadyMessage } from "@aikirun/types/publisher";
import type { Repositories, WorkflowRunOutboxRow } from "server/infra/db/types";
import type { DaemonContext } from "server/middleware/context";

import { createTimerStreamCursorAdvancer } from "./lib/timer-stream";

export interface RepublishStaleRuns {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: Publisher;
}

const advanceClaimedCursor = createTimerStreamCursorAdvancer<{ id: string; claimedAt: Date }>({
	getDueAt: (entry) => entry.claimedAt,
	getId: (entry) => entry.id,
});

const advancePublishedCursor = createTimerStreamCursorAdvancer<{ id: string; publishedAt: Date }>({
	getDueAt: (entry) => entry.publishedAt,
	getId: (entry) => entry.id,
});

export async function republishStaleRuns(
	context: DaemonContext,
	deps: RepublishStaleRuns,
	options?: { claimMinIdleTimeMs?: number; limit?: number }
) {
	const { claimMinIdleTimeMs = 90_000, limit = 1_000 } = options ?? {};

	for await (const staleEntries of streamChunks(
		(cursor) => deps.repos.workflowRunOutbox.listStaleClaimed(context, claimMinIdleTimeMs, limit, cursor),
		{
			advanceCursor: advanceClaimedCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		context.logger.info({ count: staleEntries.length }, "Releasing stale outbox claims");
		await republishRuns(context, deps.workflowRunPublisher, staleEntries);
		const staleEntryIds = staleEntries.map((entry) => entry.id) as NonEmptyArray<string>;
		await deps.repos.workflowRunOutbox.releaseStaleClaim(staleEntryIds);
	}

	for await (const staleEntries of streamChunks(
		(cursor) => deps.repos.workflowRunOutbox.listStalePublished(context, claimMinIdleTimeMs, limit, cursor),
		{
			advanceCursor: advancePublishedCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		context.logger.info({ count: staleEntries.length }, "Republishing stale published outbox entries");
		await republishRuns(context, deps.workflowRunPublisher, staleEntries);
		const staleEntryIds = staleEntries.map((entry) => entry.id) as NonEmptyArray<string>;
		await deps.repos.workflowRunOutbox.markRepublished(staleEntryIds);
	}
}

async function republishRuns(
	context: DaemonContext,
	workflowRunPublisher: Publisher,
	entries: NonEmptyArray<WorkflowRunOutboxRow>
): Promise<void> {
	const messages = entries.map((entry) => ({
		id: entry.workflowRunId,
		name: entry.workflowName,
		versionId: entry.workflowVersionId,
		rank: entry.rank,
		shard: entry.shard ?? undefined,
	})) as NonEmptyArray<WorkflowRunReadyMessage>;

	await workflowRunPublisher.publishReadyRuns(messages);
	context.logger.debug({ count: messages.length }, "Published ready workflow runs");
}
