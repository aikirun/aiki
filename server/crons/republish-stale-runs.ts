import { streamChunks } from "@aikirun/lib/async";
import type { NonEmptyArray } from "lib/dist/array";
import type { Repositories } from "server/infra/db/types";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { CronContext } from "server/middleware/context";

import { createTimerStreamCursorAdvancer } from "./lib/timer-stream";

export interface RepublishStaleRuns {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: WorkflowRunPublisher;
}

const advanceOutboxCursor = createTimerStreamCursorAdvancer<{ id: string; updatedAt: Date }>({
	getDueAt: (entry) => entry.updatedAt,
	getId: (entry) => entry.id,
});

export async function republishStaleRuns(
	context: CronContext,
	deps: RepublishStaleRuns,
	options?: { claimMinIdleTimeMs?: number; limit?: number }
) {
	const { claimMinIdleTimeMs = 90_000, limit = 50 } = options ?? {};

	for await (const staleEntries of streamChunks(
		(cursor) => deps.repos.workflowRunOutbox.listStalePublished(context, claimMinIdleTimeMs, limit, cursor),
		{
			advanceCursor: advanceOutboxCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		context.logger.info({ count: staleEntries.length }, "Republishing stale published outbox entries");

		await deps.workflowRunPublisher.publishReadyRuns(
			context,
			staleEntries.map((entry) => ({
				id: entry.workflowRunId,
				name: entry.workflowName,
				versionId: entry.workflowVersionId,
				shard: entry.shard ?? undefined,
			}))
		);

		const staleEntryIds = staleEntries.map((entry) => entry.id) as NonEmptyArray<string>;
		await deps.repos.workflowRunOutbox.markAsRepublished(staleEntryIds);
	}
}
