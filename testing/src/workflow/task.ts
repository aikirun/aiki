import type { TaskInfo, TaskStateCompleted } from "@aikirun/types/workflow/task";
import { Factory } from "fishery";

export const completedTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateCompleted<unknown> }>(
	({ sequence }) => ({
		id: `task-${sequence}`,
		name: "task",
		inputHash: "hash",
		state: { status: "completed", attempts: 1, output: undefined },
	})
);
