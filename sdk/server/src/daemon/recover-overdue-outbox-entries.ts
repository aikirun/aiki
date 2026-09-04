import { streamChunks } from "@aikirun/lib/async";
import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStateQueued } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { PageProcessingConfig } from "../config/runtime";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import { runConcurrently } from "../lib/concurrency";
import { createKeysetStreamCursorAdvancer } from "../lib/keyset-stream";
import type { DaemonContext } from "../middleware/context";

export interface RecoverOverdueOutboxEntriesDeps {
	repos: Repositories;
}

const advanceClaimedCursor = createKeysetStreamCursorAdvancer<{ id: string; claimedAt: TimestampMs }>({
	getOrder: (entry) => entry.claimedAt,
	getId: (entry) => entry.id,
});

const advancePublishedCursor = createKeysetStreamCursorAdvancer<{
	id: string;
	nextPublishAttemptRank: number;
}>({
	getOrder: (entry) => entry.nextPublishAttemptRank,
	getId: (entry) => entry.id,
});

export async function recoverOverdueOutboxEntries(
	context: DaemonContext,
	{ repos }: RecoverOverdueOutboxEntriesDeps,
	config: PageProcessingConfig & { claimIdleTimeoutMs: number }
): Promise<void> {
	const { claimIdleTimeoutMs, pageSize, chunk } = config;

	for await (const staleEntries of streamChunks(
		(cursor) => repos.workflowRunOutbox.listStaleClaimed(context, { claimIdleTimeoutMs, limit: pageSize, cursor }),
		{
			advanceCursor: advanceClaimedCursor,
			until: (page) => page.length < pageSize,
		}
	)) {
		await runConcurrently(
			context,
			chunkLazy(staleEntries, chunk.size),
			async (entriesChunk, spanCtx) => {
				const entryIds: string[] = [];
				const runIds: string[] = [];
				for (const { id, workflowRunId } of entriesChunk) {
					entryIds.push(id);
					runIds.push(workflowRunId);
				}

				if (!isNonEmptyArray(entryIds) || !isNonEmptyArray(runIds)) {
					return;
				}

				await repos.transaction(async (txRepos) => releaseStaleClaimsInTx(spanCtx, { entryIds, runIds }, txRepos));
				spanCtx.logger.debug("Recovered stale claimed outbox entries", { "aiki.count": entriesChunk.length });
			},
			{ concurrency: chunk.maxConcurrency }
		);
	}

	for await (const publishableEntries of streamChunks(
		(cursor) => repos.workflowRunOutbox.listPublishable(context, pageSize, cursor),
		{
			advanceCursor: advancePublishedCursor,
			until: (page) => page.length < pageSize,
		}
	)) {
		await runConcurrently(
			context,
			chunkLazy(publishableEntries, chunk.size),
			async (entriesChunk, spanCtx) => {
				const entryIds = entriesChunk.map((entry) => entry.id);
				if (!isNonEmptyArray(entryIds)) {
					return;
				}

				await repos.workflowRunOutbox.returnToPending(entryIds, "published");
				spanCtx.logger.debug("Recovered publishable outbox entries", { "aiki.count": entriesChunk.length });
			},
			{ concurrency: chunk.maxConcurrency }
		);
	}
}

async function releaseStaleClaimsInTx(
	context: DaemonContext,
	params: {
		entryIds: NonEmptyArray<string>;
		runIds: NonEmptyArray<string>;
	},
	txRepos: TxRepositories
): Promise<void> {
	const releasedRuns = await txRepos.workflowRun.bulkReleaseToQueued(context, params.runIds);

	if (isNonEmptyArray(releasedRuns)) {
		const stateTransitionEntries: StateTransitionRowInsert[] = [];
		const stateTransitionUpdates: {
			filter: { namespaceId: NamespaceId; id: string };
			update: { stateTransitionId: string };
		}[] = [];

		for (const run of releasedRuns) {
			const stateTransitionId = ulid();
			stateTransitionEntries.push({
				id: stateTransitionId,
				workflowRunId: run.id,
				type: "workflow_run",
				status: "queued",
				attempt: run.attempts,
				state: { status: "queued", reason: "recovery" } satisfies WorkflowRunStateQueued,
			});
			stateTransitionUpdates.push({
				filter: { namespaceId: run.namespaceId as NamespaceId, id: run.id },
				update: { stateTransitionId },
			});
		}

		if (isNonEmptyArray(stateTransitionEntries) && isNonEmptyArray(stateTransitionUpdates)) {
			await txRepos.stateTransition.appendBatch(stateTransitionEntries);
			await txRepos.workflowRun.bulkSetLatestStateTransitionId(stateTransitionUpdates);
		}
	}

	await txRepos.workflowRunOutbox.returnToPending(params.entryIds, "claimed");
}
