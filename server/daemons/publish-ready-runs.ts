import type { NonEmptyArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";
import type { Repositories, WorkflowRunOutboxRowInsert } from "server/infra/db/types";
import type { WorkflowRunPublisher, WorkflowRunReadyMessage } from "server/infra/messaging/types";
import type { DaemonContext } from "server/middleware/context";

import { createRankStreamCursorAdvancer } from "./lib/rank-stream";

export interface PublishReadyRunsDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: WorkflowRunPublisher;
}

const advanceRankStreamCursor = createRankStreamCursorAdvancer<{ id: string; rank: number }>({
	getRank: (entry) => entry.rank,
	getId: (entry) => entry.id,
});

export async function publishReadyRuns(
	context: DaemonContext,
	deps: PublishReadyRunsDeps,
	options?: { limit?: number }
) {
	const { limit = 1_000 } = options ?? {};

	for await (const pendingEntries of streamChunks(
		(cursor) => deps.repos.workflowRunOutbox.listPending(context, limit, cursor),
		{
			advanceCursor: advanceRankStreamCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		await publishRuns(context, deps.repos, deps.workflowRunPublisher, pendingEntries);
	}
}

export async function publishRuns(
	context: DaemonContext,
	repos: Pick<Repositories, "workflowRunOutbox">,
	workflowRunPublisher: WorkflowRunPublisher,
	entries: NonEmptyArray<WorkflowRunOutboxRowInsert>
): Promise<void> {
	const entryIds: string[] = [];
	const messages: WorkflowRunReadyMessage[] = [];
	for (const entry of entries) {
		entryIds.push(entry.id);
		messages.push({
			id: entry.workflowRunId,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			rank: entry.rank,
			shard: entry.shard ?? undefined,
		});
	}

	await workflowRunPublisher.publishReadyRuns(context, messages);
	await repos.workflowRunOutbox.markPublished(entryIds as NonEmptyArray<string>);
}
