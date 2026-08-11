/** biome-ignore-all lint/style/noNonNullAssertion: Manifest boundaries are tracked, hence, we never exceed array boundaries */

import type {
	ChildWorkflowRunInfo,
	ReplayManifest,
	UnconsumedManifestEntries,
	WorkflowRunAddress,
	WorkflowRunRecord,
} from "@aikirun/types/workflow/run";
import type { TaskAddress, TaskInfo } from "@aikirun/types/workflow/task";

export function createReplayManifest(run: Pick<WorkflowRunRecord, "tasks" | "childWorkflowRuns">): ReplayManifest {
	const { tasks, childWorkflowRuns } = run;

	let totalEntries = 0;
	const taskCountByAddress: Record<string, number> = {};
	const childWorkflowRunCountByAddress: Record<string, number> = {};

	for (const [address, tasksForAddress] of Object.entries(tasks)) {
		taskCountByAddress[address] = tasksForAddress.length;
		totalEntries += tasksForAddress.length;
	}
	for (const [address, childWorkflowRunsForAddress] of Object.entries(childWorkflowRuns)) {
		childWorkflowRunCountByAddress[address] = childWorkflowRunsForAddress.length;
		totalEntries += childWorkflowRunsForAddress.length;
	}

	const nextTaskIndexByAddress: Record<string, number> = {};
	const nextChildWorkflowRunIndexByAddress: Record<string, number> = {};
	let consumedEntries = 0;

	return {
		consumeNextTask(address: TaskAddress): TaskInfo | undefined {
			const taskCount = taskCountByAddress[address] ?? 0;
			const nextIndex = nextTaskIndexByAddress[address] ?? 0;
			if (nextIndex >= taskCount) {
				return undefined;
			}

			const task = tasks[address]![nextIndex]!;
			nextTaskIndexByAddress[address] = nextIndex + 1;
			consumedEntries++;

			return task;
		},

		consumeNextChildWorkflowRun(address: WorkflowRunAddress): ChildWorkflowRunInfo | undefined {
			const childWorkflowRunCount = childWorkflowRunCountByAddress[address] ?? 0;
			const nextIndex = nextChildWorkflowRunIndexByAddress[address] ?? 0;
			if (nextIndex >= childWorkflowRunCount) {
				return undefined;
			}

			const childWorkflowRun = childWorkflowRuns[address]![nextIndex]!;
			nextChildWorkflowRunIndexByAddress[address] = nextIndex + 1;
			consumedEntries++;

			return childWorkflowRun;
		},

		hasUnconsumedEntries(): boolean {
			return consumedEntries < totalEntries;
		},

		getUnconsumedEntries(): UnconsumedManifestEntries {
			const taskIds: string[] = [];
			const childWorkflowRunIds: string[] = [];

			for (const [address, taskCount] of Object.entries(taskCountByAddress)) {
				const tasksForAddress = tasks[address]!;
				const nextIndex = nextTaskIndexByAddress[address] ?? 0;

				for (let i = nextIndex; i < taskCount; i++) {
					taskIds.push(tasksForAddress[i]!.id);
				}
			}

			for (const [address, childWorkflowRunCount] of Object.entries(childWorkflowRunCountByAddress)) {
				const childWorkflowRunsForAddress = childWorkflowRuns[address]!;
				const nextIndex = nextChildWorkflowRunIndexByAddress[address] ?? 0;

				for (let i = nextIndex; i < childWorkflowRunCount; i++) {
					childWorkflowRunIds.push(childWorkflowRunsForAddress[i]!.id);
				}
			}

			return { taskIds, childWorkflowRunIds };
		},
	};
}
