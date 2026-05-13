import type { NonEmptyArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";
import type { Repositories } from "server/infra/db/types";
import type { WorkflowRunPublisher, WorkflowRunReadyMessage } from "server/infra/messaging/types";
import type { DaemonContext } from "server/middleware/context";

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
	context: DaemonContext,
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

		const messages = staleEntries.map((entry) => ({
			id: entry.workflowRunId,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			rank: entry.rank,
			shard: entry.shard ?? undefined,
		})) as NonEmptyArray<WorkflowRunReadyMessage>;

		await deps.workflowRunPublisher.publishReadyRuns(messages);
		context.logger.debug({ count: messages.length }, "Published ready workflow runs");

		const staleEntryIds = staleEntries.map((entry) => entry.id) as NonEmptyArray<string>;
		await deps.repos.workflowRunOutbox.markAsRepublished(staleEntryIds);
	}
}
