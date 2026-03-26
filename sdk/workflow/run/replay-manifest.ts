/** biome-ignore-all lint/style/noNonNullAssertion: Manifest boundaries are tracked, hence, we never exceed array boundaries */
import type { ReplayManifest, UnconsumedManifestEntries } from "@aikirun/types/replay-manifest";
import type { TaskAddress, TaskInfo } from "@aikirun/types/task";
import type { ChildWorkflowRunInfo, WorkflowRun, WorkflowRunAddress } from "@aikirun/types/workflow-run";

export function createReplayManifest(run: WorkflowRun): ReplayManifest {
	const { taskQueues, childWorkflowRunQueues } = run;

	let totalEntries = 0;
	const taskCountByAddress: Record<string, number> = {};
	const childWorkflowRunCountByAddress: Record<string, number> = {};

	for (const [address, queue] of Object.entries(taskQueues)) {
		taskCountByAddress[address] = queue.tasks.length;
		totalEntries += queue.tasks.length;
	}
	for (const [address, queue] of Object.entries(childWorkflowRunQueues)) {
		childWorkflowRunCountByAddress[address] = queue.childWorkflowRuns.length;
		totalEntries += queue.childWorkflowRuns.length;
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

			const task = taskQueues[address]!.tasks[nextIndex]!;
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

			const childWorkflowRun = childWorkflowRunQueues[address]!.childWorkflowRuns[nextIndex]!;
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
				const tasks = taskQueues[address]!.tasks;
				const nextIndex = nextTaskIndexByAddress[address] ?? 0;

				for (let i = nextIndex; i < taskCount; i++) {
					taskIds.push(tasks[i]!.id);
				}
			}

			for (const [address, childWorkflowRunCount] of Object.entries(childWorkflowRunCountByAddress)) {
				const childWorkflowRuns = childWorkflowRunQueues[address]!.childWorkflowRuns;
				const nextIndex = nextChildWorkflowRunIndexByAddress[address] ?? 0;

				for (let i = nextIndex; i < childWorkflowRunCount; i++) {
					childWorkflowRunIds.push(childWorkflowRuns[i]!.id);
				}
			}

			return { taskIds, childWorkflowRunIds };
		},
	};
}
