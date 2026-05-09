import type { NonEmptyArray } from "@aikirun/lib/array";
import { chunkLazy, isNonEmptyArray, splitArray } from "@aikirun/lib/array";
import type { WorkflowRunState, WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow-run";
import type {
	DueWorkflowRun,
	Repositories,
	StateTransitionRowInsert,
	WorkflowRow,
	WorkflowRunOutboxRowInsert,
} from "server/infra/db/types";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { TimerEntry, TimerSortedSet } from "server/infra/messaging/redis-timer-sorted-set";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

import { publishRuns } from "./publish-ready-runs";

type Repos = Pick<Repositories, "workflowRun" | "workflow" | "stateTransition" | "workflowRunOutbox" | "transaction">;

export interface ProcessImminentScheduledRunsDeps {
	repos: Repos;
	workflowRunPublisher?: WorkflowRunPublisher;
	timerSortedSet?: TimerSortedSet;
}

export async function processImminentScheduledRuns(
	context: CronContext,
	{ repos, workflowRunPublisher, timerSortedSet }: ProcessImminentScheduledRunsDeps,
	options?: { limit?: number; chunkSize?: number; imminenceThresholdMs?: number }
) {
	const { limit = 100, chunkSize = 50, imminenceThresholdMs = 2_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);
	const runs = await repos.workflowRun.listDueScheduleRuns(context, dueBefore, limit);
	if (!isNonEmptyArray(runs)) {
		return;
	}

	const now = Date.now();
	const { whenTrue: runsDueNow, whenFalse: runsDueSoon } = splitArray(runs, (run) => {
		if (run.dueAt && run.dueAt.getTime() > now) {
			return { meetsCondition: false, item: run };
		}
		return { meetsCondition: true, item: run };
	});

	if (isNonEmptyArray(runsDueNow)) {
		await queueScheduledRuns(context, repos, workflowRunPublisher, runsDueNow, { chunkSize });
	}

	if (timerSortedSet && isNonEmptyArray(runsDueSoon)) {
		const timers: TimerEntry[] = [];
		for (const run of runsDueSoon) {
			if (!run.dueAt) {
				context.logger.warn({ runId: run.id }, "Missing dueAt for scheduled run, skipping promotion");
				continue;
			}
			timers.push({
				type: "scheduled",
				id: run.id,
				dueAt: run.dueAt.getTime(),
			});
		}
		await runConcurrently(context, chunkLazy(timers, chunkSize), async (chunk) => {
			await timerSortedSet.add(chunk);
		});
	}
}

export async function queueScheduledRuns(
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<DueWorkflowRun>,
	options?: { chunkSize?: number }
) {
	const { chunkSize = 50 } = options ?? {};

	const stateTransitionIds: string[] = [];
	const workflowIdSet = new Set<string>();
	for (const run of runs) {
		stateTransitionIds.push(run.latestStateTransitionId);
		workflowIdSet.add(run.workflowId);
	}
	const workflowIds = Array.from(workflowIdSet);

	if (!isNonEmptyArray(stateTransitionIds) || !isNonEmptyArray(workflowIds)) {
		return;
	}

	const [stateTransitions, workflows] = await Promise.all([
		repos.stateTransition.getByIds(stateTransitionIds),
		repos.workflow.getByIdsGlobal(context, workflowIds),
	]);
	const stateTransitionsById = new Map(stateTransitions.map((transition) => [transition.id, transition]));
	const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

	await runConcurrently(context, chunkLazy(runs, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, repos, workflowRunPublisher, chunk, stateTransitionsById, workflowsById);
		} catch (error) {
			spanCtx.logger.warn({ err: error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

async function processChunk(
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<DueWorkflowRun>,
	stateTransitionsById: Map<string, { id: string; state: unknown }>,
	workflowsById: Map<string, WorkflowRow>
): Promise<void> {
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: Array<{ filter: { id: string; revision: number }; update: { stateTransitionId: string } }> =
		[];
	const outboxEntries: WorkflowRunOutboxRowInsert[] = [];

	for (const run of runs) {
		const workflow = workflowsById.get(run.workflowId);
		if (!workflow) {
			continue;
		}

		const transition = stateTransitionsById.get(run.latestStateTransitionId);
		if (!transition) {
			continue;
		}
		const fromState = transition.state as WorkflowRunState;
		if (fromState.status !== "scheduled") {
			continue;
		}

		const stateTransitionId = ulid();
		const toState: WorkflowRunStateQueued = { status: "queued", reason: fromState.reason };
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "queued",
			attempt: run.attempts,
			state: toState,
		});
		workflowRunUpdates.push({
			filter: {
				id: run.id,
				revision: run.revision,
			},
			update: {
				stateTransitionId,
			},
		});
		outboxEntries.push({
			id: ulid(),
			namespaceId: run.namespaceId,
			workflowRunId: run.id,
			workflowName: workflow.name,
			workflowVersionId: workflow.versionId,
			shard: (run.options as WorkflowStartOptions | null)?.shard,
			status: "pending",
		});
	}

	if (!isNonEmptyArray(stateTransitionEntries) || !isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await repos.transaction(async (txRepos) => {
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued("scheduled", workflowRunUpdates);
		const transitionedRunIdsSet = new Set(transitionedRunIds);
		const outboxEntriesToInsert = outboxEntries.filter((entry) => transitionedRunIdsSet.has(entry.workflowRunId));
		if (!isNonEmptyArray(outboxEntriesToInsert)) {
			return [];
		}
		await txRepos.workflowRunOutbox.createBatch(outboxEntriesToInsert);
		return outboxEntriesToInsert;
	});

	if (workflowRunPublisher && isNonEmptyArray(insertedOutboxEntries)) {
		await publishRuns(context, repos, workflowRunPublisher, insertedOutboxEntries);
	}
}
