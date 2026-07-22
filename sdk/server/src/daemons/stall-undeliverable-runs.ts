import { streamChunks } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowRunStateStalled } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { Repositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import { ulidUpperBound } from "../lib/ulid";
import type { DaemonContext } from "../middleware/context";
import { discardStaleTasks } from "../service/discard-stale-tasks";

type Repos = Pick<Repositories, "workflowRunOutbox" | "workflowRun" | "stateTransition" | "task" | "transaction">;

export interface StallUndeliverableRunsDeps {
	repos: Repos;
}

const advanceStreamCursor = (_cursor: string | undefined, item: { id: string }) => item.id;

export async function stallUndeliverableRuns(
	context: DaemonContext,
	{ repos }: StallUndeliverableRunsDeps,
	{ maxAgeMs, limit }: { maxAgeMs: number; limit: number }
): Promise<void> {
	const maxId = ulidUpperBound(Date.now() - maxAgeMs);

	for await (const undeliverableEntries of streamChunks(
		(cursor) => repos.workflowRunOutbox.listUndeliverable(context, maxId, limit, cursor),
		{
			advanceCursor: advanceStreamCursor,
			until: (chunk) => chunk.length < limit,
		}
	)) {
		const undeliverableRunIds = undeliverableEntries.map((entry) => entry.workflowRunId) as NonEmptyArray<string>;
		const stalledRunIds = await stallByRunIds(context, repos, undeliverableRunIds);
		context.logger.info("Stalled undeliverable runs", { "aiki.count": stalledRunIds.length });
	}
}

export async function stallByRunIds(context: DaemonContext, repos: Repos, runIds: NonEmptyArray<string>) {
	return repos.transaction(async (txRepos) => {
		const stalledRunIds = await txRepos.workflowRun.bulkTransitionToStalled(runIds);
		if (!isNonEmptyArray(stalledRunIds)) {
			return [];
		}

		await discardStaleTasks(stalledRunIds, ["running", "awaiting_retry"], txRepos);

		await txRepos.workflowRunOutbox.deleteByWorkflowRunIds(stalledRunIds);

		const stalledRuns = await txRepos.workflowRun.getByIdsGlobal(context, stalledRunIds);

		const stallStateTransitionEntries: StateTransitionRowInsert[] = [];
		const stalledRunStateTransitionUpdates: { id: string; stateTransitionId: string }[] = [];

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
			stalledRunStateTransitionUpdates.push({ id: run.id, stateTransitionId });
		}

		if (isNonEmptyArray(stallStateTransitionEntries) && isNonEmptyArray(stalledRunStateTransitionUpdates)) {
			await txRepos.stateTransition.appendBatch(stallStateTransitionEntries);
			await txRepos.workflowRun.bulkSetLatestStateTransitionId(stalledRunStateTransitionUpdates);
		}

		return stalledRunIds;
	});
}
