import { streamChunks } from "@aikirun/lib/async";
import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { WorkflowRunStateQueued } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { Repositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import { createKeysetStreamCursorAdvancer } from "../lib/keyset-stream";
import type { DaemonContext } from "../middleware/context";

type Repos = Pick<Repositories, "workflowRunOutbox" | "workflowRun" | "stateTransition" | "transaction">;

export interface RecoverStaleOutboxEntriesDeps {
	repos: Repos;
}

const advanceClaimedCursor = createKeysetStreamCursorAdvancer<{ id: string; claimedAt: TimestampMs }>({
	getOrder: (entry) => entry.claimedAt,
	getId: (entry) => entry.id,
});

const advancePublishedCursor = createKeysetStreamCursorAdvancer<{
	id: string;
	nextPublishAttemptAt: TimestampMs;
}>({
	getOrder: (entry) => entry.nextPublishAttemptAt,
	getId: (entry) => entry.id,
});

export async function recoverStaleOutboxEntries(
	context: DaemonContext,
	{ repos }: RecoverStaleOutboxEntriesDeps,
	{ claimMinIdleTimeMs, limit }: { claimMinIdleTimeMs: number; limit: number }
): Promise<void> {
	for await (const staleEntries of streamChunks(
		(cursor) => repos.workflowRunOutbox.listStaleClaimed(context, claimMinIdleTimeMs, limit, cursor),
		{
			advanceCursor: advanceClaimedCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		const entryIds: string[] = [];
		const runIds: string[] = [];
		for (const { id, workflowRunId } of staleEntries) {
			entryIds.push(id);
			runIds.push(workflowRunId);
		}

		if (!isNonEmptyArray(entryIds) || !isNonEmptyArray(runIds)) {
			continue;
		}

		await repos.transaction(async (txRepos) => {
			const releasedRuns = await txRepos.workflowRun.bulkReleaseToQueued(runIds);

			if (isNonEmptyArray(releasedRuns)) {
				const stateTransitionEntries: StateTransitionRowInsert[] = [];
				const stateTransitionUpdates: { id: string; stateTransitionId: string }[] = [];

				for (const run of releasedRuns) {
					const stateTransitionId = ulid();
					stateTransitionEntries.push({
						id: stateTransitionId,
						workflowRunId: run.id,
						type: "workflow_run",
						status: "queued",
						attempt: run.attempts,
						state: { status: "queued", reason: "recovered" } satisfies WorkflowRunStateQueued,
					});
					stateTransitionUpdates.push({ id: run.id, stateTransitionId });
				}

				if (isNonEmptyArray(stateTransitionEntries) && isNonEmptyArray(stateTransitionUpdates)) {
					await txRepos.stateTransition.appendBatch(stateTransitionEntries);
					await txRepos.workflowRun.bulkSetLatestStateTransitionId(stateTransitionUpdates);
				}
			}

			await txRepos.workflowRunOutbox.returnToPending(entryIds, "claimed");
		});

		context.logger.debug("Recovered stale claimed outbox entries", { "aiki.count": staleEntries.length });
	}

	for await (const publishableEntries of streamChunks(
		(cursor) => repos.workflowRunOutbox.listPublishable(context, limit, cursor),
		{
			advanceCursor: advancePublishedCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		const entryIds = publishableEntries.map((entry) => entry.id);
		if (!isNonEmptyArray(entryIds)) {
			continue;
		}

		await repos.workflowRunOutbox.returnToPending(entryIds, "published");
		context.logger.debug("Recovered publishable outbox entries", { "aiki.count": publishableEntries.length });
	}
}
