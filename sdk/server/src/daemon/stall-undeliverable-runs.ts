import { streamChunks } from "@aikirun/lib/async";
import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStateStalled } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { PageProcessingConfig } from "../config/runtime";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import { runConcurrently } from "../lib/concurrency";
import { ulidUpperBound } from "../lib/ulid";
import type { DaemonContext } from "../middleware/context";
import { discardStaleTasks } from "../service/discard-stale-tasks";

export interface StallUndeliverableRunsDeps {
	repos: Repositories;
}

const advanceStreamCursor = (_cursor: string | undefined, item: { id: string }) => item.id;

export async function stallUndeliverableRuns(
	context: DaemonContext,
	{ repos }: StallUndeliverableRunsDeps,
	config: PageProcessingConfig & { maxAgeMs: number }
): Promise<void> {
	const { pageSize, chunk, maxAgeMs } = config;
	const maxId = ulidUpperBound(Date.now() - maxAgeMs);

	for await (const undeliverableEntries of streamChunks(
		(cursorId) => repos.workflowRunOutbox.listUndeliverable(context, { maxId, limit: pageSize, cursorId }),
		{
			advanceCursor: advanceStreamCursor,
			until: (page) => page.length < pageSize,
		}
	)) {
		await runConcurrently(
			context,
			chunkLazy(undeliverableEntries, chunk.size),
			async (entriesChunk, spanCtx) => {
				const undeliverableRunIds = entriesChunk.map((entry) => entry.workflowRunId) as NonEmptyArray<string>;
				const stalledRunIds = await repos.transaction(async (txRepos) =>
					stallByRunIdsInTx(spanCtx, undeliverableRunIds, txRepos)
				);
				spanCtx.logger.info("Stalled undeliverable runs", { "aiki.count": stalledRunIds.length });
			},
			{ concurrency: chunk.maxConcurrency }
		);
	}
}

async function stallByRunIdsInTx(context: DaemonContext, runIds: NonEmptyArray<string>, txRepos: TxRepositories) {
	const stalledRuns = await txRepos.workflowRun.bulkTransitionToStalled(context, runIds);
	if (!isNonEmptyArray(stalledRuns)) {
		return [];
	}
	const stalledRunIds = stalledRuns.map((run) => run.id) as NonEmptyArray<string>;

	await discardStaleTasks(stalledRunIds, ["running", "awaiting_retry"], txRepos);

	await txRepos.workflowRunOutbox.deleteByWorkflowRunIds(stalledRunIds);

	const stallStateTransitionEntries: StateTransitionRowInsert[] = [];
	const stalledRunStateTransitionUpdates: {
		filter: { namespaceId: NamespaceId; id: string };
		update: { stateTransitionId: string };
	}[] = [];

	for (const run of stalledRuns) {
		const stateTransitionId = ulid();
		stallStateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "stalled",
			attempt: run.attempts,
			state: { status: "stalled" } satisfies WorkflowRunStateStalled,
		});
		stalledRunStateTransitionUpdates.push({
			filter: { namespaceId: run.namespaceId as NamespaceId, id: run.id },
			update: { stateTransitionId },
		});
	}

	if (isNonEmptyArray(stallStateTransitionEntries) && isNonEmptyArray(stalledRunStateTransitionUpdates)) {
		await txRepos.stateTransition.appendBatch(stallStateTransitionEntries);
		await txRepos.workflowRun.bulkSetLatestStateTransitionId(stalledRunStateTransitionUpdates);
	}

	return stalledRunIds;
}
