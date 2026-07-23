import { streamChunks } from "@aikirun/lib/async";
import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { Publisher } from "@aikirun/types/infra/queue";

import { publishOutboxEntries } from "./publish-ready-runs";
import type { Repositories } from "../infra/db/types";
import { createKeysetStreamCursorAdvancer } from "../lib/keyset-stream";
import type { DaemonContext } from "../middleware/context";

export interface RepublishStaleRuns {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: Publisher;
}

const advanceClaimedCursor = createKeysetStreamCursorAdvancer<{ id: string; claimedAt: TimestampMs }>({
	getOrder: (entry) => entry.claimedAt,
	getId: (entry) => entry.id,
});

const advancePublishedCursor = createKeysetStreamCursorAdvancer<{ id: string; publishedAt: TimestampMs }>({
	getOrder: (entry) => entry.publishedAt,
	getId: (entry) => entry.id,
});

export async function republishStaleRuns(
	context: DaemonContext,
	deps: RepublishStaleRuns,
	{ claimMinIdleTimeMs, limit }: { claimMinIdleTimeMs: number; limit: number }
) {
	for await (const staleEntries of streamChunks(
		(cursor) => deps.repos.workflowRunOutbox.listStaleClaimed(context, claimMinIdleTimeMs, limit, cursor),
		{
			advanceCursor: advanceClaimedCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		context.logger.debug("Releasing stale outbox claims", { "aiki.count": staleEntries.length });
		const publishedEntryIds = await publishOutboxEntries(context, deps.workflowRunPublisher, staleEntries);
		if (isNonEmptyArray(publishedEntryIds)) {
			await deps.repos.workflowRunOutbox.releaseStaleClaim(publishedEntryIds);
		}
	}

	for await (const staleEntries of streamChunks(
		(cursor) => deps.repos.workflowRunOutbox.listStalePublished(context, claimMinIdleTimeMs, limit, cursor),
		{
			advanceCursor: advancePublishedCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		context.logger.debug("Republishing stale published outbox entries", { "aiki.count": staleEntries.length });
		const publishedEntryIds = await publishOutboxEntries(context, deps.workflowRunPublisher, staleEntries);
		if (isNonEmptyArray(publishedEntryIds)) {
			await deps.repos.workflowRunOutbox.markRepublished(publishedEntryIds);
		}
	}
}
