import type { TaskInfo, TaskStateCompleted, TaskStateFailed, TaskStateRunning } from "@aikirun/types/workflow/task";
import { Factory } from "fishery";

export const runningTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateRunning<unknown> }>(
	({ sequence }) => ({
		id: `task-${sequence}`,
		name: "task",
		inputHash: "hash",
		state: { status: "running", attempts: 1, input: undefined },
	})
);

export const failedTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateFailed }>(({ sequence }) => ({
	id: `task-${sequence}`,
	name: "task",
	inputHash: "hash",
	state: { status: "failed", attempts: 1, error: { name: "Error", message: "task failed" } },
}));

export const completedTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateCompleted<unknown> }>(
	({ sequence }) => ({
		id: `task-${sequence}`,
		name: "task",
		inputHash: "hash",
		state: { status: "completed", attempts: 1, output: undefined },
	})
);
