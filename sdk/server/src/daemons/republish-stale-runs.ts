import { streamChunks } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher, ReadyWorkflowRun } from "@aikirun/types/infra/queue";

import type { Repositories } from "../infra/db/types";
import type { WorkflowRunOutboxRow } from "../infra/db/types/workflow-run-outbox";
import { createTimerStreamCursorAdvancer } from "../lib/timer-stream";
import type { DaemonContext } from "../middleware/context";

export interface RepublishStaleRuns {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: Publisher;
}

const advanceClaimedCursor = createTimerStreamCursorAdvancer<{ id: string; claimedAt: TimestampMs }>({
	getDueAt: (entry) => entry.claimedAt,
	getId: (entry) => entry.id,
});

const advancePublishedCursor = createTimerStreamCursorAdvancer<{ id: string; publishedAt: TimestampMs }>({
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
		context.logger.info("Releasing stale outbox claims", { count: staleEntries.length });
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
		context.logger.info("Republishing stale published outbox entries", { count: staleEntries.length });
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
	const runs = entries.map((entry) => ({
		namespaceId: entry.namespaceId,
		id: entry.workflowRunId,
		name: entry.workflowName,
		versionId: entry.workflowVersionId,
		rank: entry.rank,
		shard: entry.shard ?? undefined,
	})) as NonEmptyArray<ReadyWorkflowRun>;

	await workflowRunPublisher.publishReadyRuns(runs);
	context.logger.debug("Published ready workflow runs", { count: runs.length });
}
