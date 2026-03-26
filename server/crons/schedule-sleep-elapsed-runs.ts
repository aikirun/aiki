import { chunkLazy, isNonEmptyArray } from "@aikirun/lib";
import type { NonEmptyArray } from "@aikirun/lib/array";
import type { WorkflowRunStateScheduled } from "@aikirun/types/workflow-run";
import type { Repositories, StateTransitionRowInsert } from "server/infra/db/types";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface ScheduleSleepElapsedRunsDeps {
	repos: Pick<Repositories, "workflowRun" | "stateTransition" | "sleepQueue" | "transaction">;
}

export async function scheduleSleepElapsedWorkflowRuns(
	context: CronContext,
	{ repos }: ScheduleSleepElapsedRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const runs = await repos.workflowRun.listSleepElapsedRuns(limit);
	if (!isNonEmptyArray(runs)) {
		return;
	}

	await runConcurrently(context, chunkLazy(runs, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, repos, chunk);
		} catch (error) {
			spanCtx.logger.warn({ err: error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

async function processChunk(
	_context: CronContext,
	repos: ScheduleSleepElapsedRunsDeps["repos"],
	runs: NonEmptyArray<{ id: string; revision: number; attempts: number }>
) {
	const now = Date.now();
	const completedAt = new Date(now);

	const workflowRunIds = runs.map((run) => run.id);

	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: { id: string; revision: number; stateTransitionId: string }[] = [];

	for (const run of runs) {
		const stateTransitionId = ulid();
		const state: WorkflowRunStateScheduled = { status: "scheduled", scheduledAt: now, reason: "awake" };
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "scheduled",
			attempt: run.attempts,
			state,
		});
		workflowRunUpdates.push({
			id: run.id,
			revision: run.revision,
			stateTransitionId,
		});
	}

	if (
		!isNonEmptyArray(workflowRunIds) ||
		!isNonEmptyArray(stateTransitionEntries) ||
		!isNonEmptyArray(workflowRunUpdates)
	) {
		return;
	}

	await repos.transaction(async (txRepos) => {
		await txRepos.sleepQueue.bulkCompleteByWorkflowRunIds(workflowRunIds, completedAt);
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		await txRepos.workflowRun.bulkTransitionToScheduled("sleeping", workflowRunUpdates, completedAt);
	});
}
