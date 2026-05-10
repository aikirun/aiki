import type { NonEmptyArray } from "@aikirun/lib/array";
import { chunkLazy, isNonEmptyArray } from "@aikirun/lib/array";
import type { WorkflowRunState, WorkflowRunStateQueued, WorkflowStartOptions } from "@aikirun/types/workflow-run";
import type { WorkflowRunMeta } from "server/infra/db/pg/repository/workflow-run";
import type {
	ChildWorkflowRunWaitQueueRowInsert,
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

import { streamTimers } from "./lib/timer-stream";
import { publishRuns } from "./publish-ready-runs";

type Repos = Pick<
	Repositories,
	"workflowRun" | "stateTransition" | "childWorkflowRunWaitQueue" | "workflow" | "workflowRunOutbox" | "transaction"
>;

export interface ProcessImminentChildRunWaitTimedOutRunsDeps {
	repos: Repos;
	workflowRunPublisher?: WorkflowRunPublisher;
	timerSortedSet?: TimerSortedSet;
}

export async function processImminentChildRunWaitTimedOutRuns(
	context: CronContext,
	{ repos, workflowRunPublisher, timerSortedSet }: ProcessImminentChildRunWaitTimedOutRunsDeps,
	options?: { limit?: number; imminenceThresholdMs?: number }
) {
	const { limit = 100, imminenceThresholdMs = 2_000 } = options ?? {};

	const dueBefore = new Date(Date.now() + imminenceThresholdMs);

	for await (const { dueNow: runsDueNow, dueSoon: runsDueSoon } of streamTimers(
		(cursor) => repos.workflowRun.listChildRunWaitTimedOutRuns(context, dueBefore, limit, cursor),
		(chunk) => chunk.length < limit
	)) {
		if (isNonEmptyArray(runsDueNow)) {
			await queueChildRunWaitTimedOutRuns(context, repos, workflowRunPublisher, runsDueNow);
		}

		if (timerSortedSet && isNonEmptyArray(runsDueSoon)) {
			const timers: TimerEntry[] = runsDueSoon.map((run) => ({
				type: "child_wait_timeout",
				id: run.id,
				dueAt: run.dueAt.getTime(),
			}));
			if (isNonEmptyArray(timers)) {
				await timerSortedSet.add(timers);
			}
		}
	}
}

export async function queueChildRunWaitTimedOutRuns(
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<WorkflowRunMeta>,
	options?: { chunkSize?: number }
) {
	const { chunkSize = runs.length } = options ?? {};

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
			spanCtx.logger.warn({ error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

async function processChunk(
	context: CronContext,
	repos: Repos,
	workflowRunPublisher: WorkflowRunPublisher | undefined,
	runs: NonEmptyArray<WorkflowRunMeta>,
	stateTransitionsById: Map<string, { id: string; state: unknown }>,
	workflowsById: Map<string, WorkflowRow>
): Promise<void> {
	const timedOutAt = new Date();

	const childRunWaitEntries: ChildWorkflowRunWaitQueueRowInsert[] = [];
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
		if (fromState.status !== "awaiting_child_workflow") {
			continue;
		}

		childRunWaitEntries.push({
			id: ulid(),
			parentWorkflowRunId: run.id,
			childWorkflowRunId: fromState.childWorkflowRunId,
			childWorkflowRunStatus: fromState.childWorkflowRunStatus,
			status: "timeout",
			timedOutAt,
		});

		const stateTransitionId = ulid();
		const toState: WorkflowRunStateQueued = { status: "queued", reason: "child_workflow" };
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

	if (
		!isNonEmptyArray(childRunWaitEntries) ||
		!isNonEmptyArray(stateTransitionEntries) ||
		!isNonEmptyArray(workflowRunUpdates)
	) {
		return;
	}

	const insertedOutboxEntries: WorkflowRunOutboxRowInsert[] = await repos.transaction(async (txRepos) => {
		await txRepos.childWorkflowRunWaitQueue.insert(childRunWaitEntries);
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		const transitionedRunIds = await txRepos.workflowRun.bulkTransitionToQueued(
			"awaiting_child_workflow",
			workflowRunUpdates
		);
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
