import { streamChunks } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStateStalled } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { Repositories, TxRepositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
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
	{ limit, maxAgeMs }: { limit: number; maxAgeMs: number }
): Promise<void> {
	const maxId = ulidUpperBound(Date.now() - maxAgeMs);

	for await (const undeliverableEntries of streamChunks(
		(cursorId) => repos.workflowRunOutbox.listUndeliverable(context, { maxId, limit, cursorId }),
		{
			advanceCursor: advanceStreamCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		const undeliverableRunIds = undeliverableEntries.map((entry) => entry.workflowRunId) as NonEmptyArray<string>;
		const stalledRunIds = await repos.transaction(async (txRepos) =>
			stallByRunIdsInTx(context, undeliverableRunIds, txRepos)
		);
		context.logger.info("Stalled undeliverable runs", { "aiki.count": stalledRunIds.length });
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
