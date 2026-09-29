import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { asNonEmptyArray, isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { DiscardableTaskStatus, TaskStateDiscarded } from "@aikirun/types/workflow/task";
import { ulid } from "ulidx";

import type { TxRepositories } from "../infra/db/types";
import type { TaskStateTransitionRowInsert } from "../infra/db/types/state-transition";

export async function discardStaleTasks(
	runs: NonEmptyArray<{ id: string; revision: number }>,
	staleStatuses: NonEmptyArray<DiscardableTaskStatus>,
	txRepos: TxRepositories
): Promise<void> {
	const revisionByRunId = new Map(runs.map((run) => [run.id, run.revision]));
	const staleTasks = await txRepos.task.listByWorkflowRunIdsAndStatuses(
		asNonEmptyArray(Array.from(revisionByRunId.keys())),
		staleStatuses
	);
	if (!isNonEmptyArray(staleTasks)) {
		return;
	}

	const taskUpdatesById = new Map(
		staleTasks.map((task) => {
			const revision = revisionByRunId.get(task.workflowRunId);
			if (revision === undefined) {
				throw new Error(`Attempted to discard unexpected task ${task.id}`);
			}
			return [
				task.id,
				{
					filter: {
						id: task.id,
						workflowRunId: task.workflowRunId,
						status: task.status as DiscardableTaskStatus,
						attempts: task.attempts,
					},
					update: { latestStateTransitionId: ulid() },
					revision,
				},
			];
		})
	);
	const taskUpdates = Array.from(taskUpdatesById.values());
	const discardedTaskIds = await txRepos.task.bulkTransitionToDiscarded(asNonEmptyArray(taskUpdates));
	if (!isNonEmptyArray(discardedTaskIds)) {
		return;
	}

	const stateTransitionEntries: TaskStateTransitionRowInsert[] = [];

	for (const discardedTaskId of discardedTaskIds) {
		const taskUpdate = taskUpdatesById.get(discardedTaskId);
		if (!taskUpdate) {
			throw new Error(`Task ${discardedTaskId} was discarded unexpectedly`);
		}
		stateTransitionEntries.push({
			id: taskUpdate.update.latestStateTransitionId,
			workflowRunId: taskUpdate.filter.workflowRunId,
			type: "task",
			taskId: discardedTaskId,
			attempt: taskUpdate.filter.attempts,
			revision: taskUpdate.revision,
			// Every caller discards in the transaction whose run transition opens this revision, and no
			// worker writes task transitions at that revision, so 0 sorts the discards right after the run
			// transition. At a revision a worker executes, 0 would put them before its transitions.
			taskSequence: 0,
			state: { status: "discarded" } satisfies TaskStateDiscarded,
		});
	}

	if (isNonEmptyArray(stateTransitionEntries)) {
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
	}
}
