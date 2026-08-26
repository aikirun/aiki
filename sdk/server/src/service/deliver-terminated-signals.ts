import { asNonEmptyArray, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Logger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";
import type {
	TerminalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateScheduledByChildWorkflow,
} from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { TxRepositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { ImminentRunTimerQueue } from "../infra/timer/imminent-run-timer-queue";

export interface TerminatedChildRun {
	namespaceId: NamespaceId;
	id: string;
	latestStateTransitionId: string;
	parentWorkflowRunId: string;
	status: TerminalWorkflowRunStatus;
}

/**
 * Delivers the terminal signal of each child run to its parent, in one batch: writes the
 * terminal wait rows, bumps each parent's signal sequence once, and wakes the parents that
 * are parked on one of the children. Every path that takes a run with a parent to a
 * terminal state must pass through here — a path that skips it opens a path to a lost-wakeup race.
 */
export async function deliverTerminatedSignalToParentRun(
	runs: NonEmptyArray<TerminatedChildRun>,
	now: TimestampMs,
	txRepos: TxRepositories,
	logger: Logger,
	imminentRunTimerQueue: ImminentRunTimerQueue | undefined
): Promise<void> {
	await txRepos.childWorkflowRunWait.insert(
		runs.map((run) => ({
			id: ulid(),
			parentWorkflowRunId: run.parentWorkflowRunId,
			childWorkflowRunId: run.id,
			childWorkflowRunStatus: run.status,
			status: "completed",
			completedAt: now,
			childWorkflowRunStateTransitionId: run.latestStateTransitionId,
		}))
	);

	const parentsRunsById = new Map<WorkflowRunId, { namespaceId: NamespaceId; id: WorkflowRunId }>();
	for (const run of runs) {
		const parentRunId = run.parentWorkflowRunId as WorkflowRunId;
		parentsRunsById.set(parentRunId, { namespaceId: run.namespaceId, id: parentRunId });
	}
	// One sequence bump per unique parent, even if it has several children in the batch:
	// 		the sequence records that a signal arrived, not how many.
	// The bumps acquire locks on each parent run so that the wakeup is never lost if its current status
	// is running but there is a concurrent state transition moving it to awaiting_child_workflow
	const incrementedParentsRuns = await txRepos.workflowRun.bulkIncrementSignalSequence(
		asNonEmptyArray(Array.from(parentsRunsById.values()))
	);

	const parkedParentsRuns = incrementedParentsRuns.filter((parent) => parent.status === "awaiting_child_workflow");
	if (!isNonEmptyArray(parkedParentsRuns)) {
		return;
	}

	const parentRunsLatestTransition = await txRepos.stateTransition.getByIds(
		asNonEmptyArray(parkedParentsRuns.map((parent) => parent.latestStateTransitionId))
	);
	const parentRunStateByTransitionId = new Map(
		parentRunsLatestTransition.map((transition) => [transition.id, transition.state as WorkflowRunState])
	);

	const childRunIds = new Set<string>(runs.map((childRun) => childRun.id));
	const parentRunStateTransitionEntries: StateTransitionRowInsert[] = [];
	const parentRunUpdates: {
		filter: { namespaceId: NamespaceId; id: string; revision: number };
		update: { stateTransitionId: string };
	}[] = [];

	for (const parentRun of parkedParentsRuns) {
		const parentRunState = parentRunStateByTransitionId.get(parentRun.latestStateTransitionId);
		if (
			parentRunState?.status !== "awaiting_child_workflow" ||
			// skip wake if parent is parked on a child not part of the batch generating the signal
			!childRunIds.has(parentRunState.childWorkflowRunId)
		) {
			continue;
		}

		const stateTransitionId = ulid();
		parentRunStateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: parentRun.id,
			type: "workflow_run",
			status: "scheduled",
			attempt: parentRun.attempts,
			state: {
				status: "scheduled",
				reason: "child_workflow",
				scheduledAt: now,
			} satisfies WorkflowRunStateScheduledByChildWorkflow,
		});
		parentRunUpdates.push({
			filter: { namespaceId: parentRun.namespaceId as NamespaceId, id: parentRun.id, revision: parentRun.revision },
			update: { stateTransitionId },
		});
	}

	if (!isNonEmptyArray(parentRunUpdates)) {
		return;
	}

	const scheduledParentRunIds = await txRepos.workflowRun.bulkTransitionToScheduled(
		"awaiting_child_workflow",
		now,
		parentRunUpdates
	);
	if (!isNonEmptyArray(scheduledParentRunIds)) {
		return;
	}

	let parentRunStateTransitionEntriesToInsert = parentRunStateTransitionEntries;
	if (scheduledParentRunIds.length !== parentRunStateTransitionEntries.length) {
		const scheduledParentRunIdSet = new Set(scheduledParentRunIds);
		parentRunStateTransitionEntriesToInsert = parentRunStateTransitionEntries.filter((entry) =>
			scheduledParentRunIdSet.has(entry.workflowRunId)
		);
	}
	if (isNonEmptyArray(parentRunStateTransitionEntriesToInsert)) {
		await txRepos.stateTransition.appendBatch(parentRunStateTransitionEntriesToInsert);
	}

	if (imminentRunTimerQueue) {
		txRepos.onCommit(() =>
			imminentRunTimerQueue.add(asNonEmptyArray(scheduledParentRunIds.map((id) => ({ id, scheduledAt: now }))))
		);
	}

	logger.info("Woke parents parked on terminal children", { "aiki.parentRunIds": scheduledParentRunIds });
}
