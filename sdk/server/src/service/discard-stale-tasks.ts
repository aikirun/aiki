import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { TaskStateDiscarded } from "@aikirun/types/workflow/task";
import { ulid } from "ulidx";

import type { Repositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";

export async function discardStaleTasks(
	workflowRunIds: string | NonEmptyArray<string>,
	txRepos: Pick<Repositories, "task" | "stateTransition">
): Promise<void> {
	const staleTasks = await txRepos.task.listByWorkflowRunIdsAndStatuses(workflowRunIds, [
		"running",
		"awaiting_retry",
		"failed",
	]);
	if (!isNonEmptyArray(staleTasks)) {
		return;
	}

	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const taskUpdates: Array<{ filter: { id: string }; update: { latestStateTransitionId: string } }> = [];

	for (const task of staleTasks) {
		const transitionId = ulid();
		stateTransitionEntries.push({
			id: transitionId,
			workflowRunId: task.workflowRunId,
			type: "task",
			taskId: task.id,
			status: "discarded",
			attempt: task.attempts,
			state: { status: "discarded", attempts: task.attempts } satisfies TaskStateDiscarded,
		});
		taskUpdates.push({
			filter: { id: task.id },
			update: { latestStateTransitionId: transitionId },
		});
	}

	if (!isNonEmptyArray(stateTransitionEntries) || !isNonEmptyArray(taskUpdates)) {
		return;
	}

	await txRepos.stateTransition.appendBatch(stateTransitionEntries);
	await txRepos.task.bulkDiscard(taskUpdates);
}
