import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { asNonEmptyArray, isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TaskStateDiscarded } from "@aikirun/types/workflow/task";
import { ulid } from "ulidx";

import type { TxRepositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";

type DiscardableTaskStatus = "running" | "awaiting_retry" | "failed";

export async function discardStaleTasks(
	workflowRunIds: string | NonEmptyArray<string>,
	staleStatuses: NonEmptyArray<DiscardableTaskStatus>,
	txRepos: TxRepositories
): Promise<void> {
	const staleTasks = await txRepos.task.listByWorkflowRunIdsAndStatuses(workflowRunIds, staleStatuses);
	if (!isNonEmptyArray(staleTasks)) {
		return;
	}

	const taskUpdatesById = new Map(
		staleTasks.map((task) => [
			task.id,
			{
				filter: { id: task.id, workflowRunId: task.workflowRunId, status: task.status, attempts: task.attempts },
				update: { latestStateTransitionId: ulid() },
			},
		])
	);
	const taskUpdates = Array.from(taskUpdatesById.values());
	const discardedTaskIds = await txRepos.task.bulkDiscard(asNonEmptyArray(taskUpdates));
	if (!isNonEmptyArray(discardedTaskIds)) {
		return;
	}

	const stateTransitionEntries: StateTransitionRowInsert[] = [];

	for (const discardedTaskId of discardedTaskIds) {
		const taskUpdate = taskUpdatesById.get(discardedTaskId);
		if (!taskUpdate) {
			continue;
		}
		stateTransitionEntries.push({
			id: taskUpdate.update.latestStateTransitionId,
			workflowRunId: taskUpdate.filter.workflowRunId,
			type: "task",
			taskId: discardedTaskId,
			status: "discarded",
			attempt: taskUpdate.filter.attempts,
			state: { status: "discarded", attempts: taskUpdate.filter.attempts } satisfies TaskStateDiscarded,
		});
	}

	if (isNonEmptyArray(stateTransitionEntries)) {
		await txRepos.stateTransition.appendBatch(stateTransitionEntries);
	}
}
