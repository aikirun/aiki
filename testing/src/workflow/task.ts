import type { TaskInfo, TaskStateCompleted, TaskStateRunning } from "@aikirun/types/workflow/task";
import { Factory } from "fishery";

export const runningTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateRunning<unknown> }>(
	({ sequence }) => ({
		id: `task-${sequence}`,
		name: "task",
		inputHash: "hash",
		state: { status: "running", attempts: 1, input: undefined },
	})
);

export const completedTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateCompleted<unknown> }>(
	({ sequence }) => ({
		id: `task-${sequence}`,
		name: "task",
		inputHash: "hash",
		state: { status: "completed", attempts: 1, output: undefined },
	})
);
