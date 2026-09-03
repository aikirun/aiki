import type {
	TaskInfo,
	TaskStateAwaitingRetry,
	TaskStateCompleted,
	TaskStateFailed,
	TaskStateRunning,
} from "@aikirun/types/workflow/task";
import { Factory } from "fishery";

export const runningTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateRunning }>(({ sequence }) => ({
	id: `task-${sequence}`,
	name: "task",
	inputHash: "hash",
	attempts: 1,
	state: { status: "running" },
}));

export const awaitingRetryTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateAwaitingRetry }>(
	({ sequence }) => ({
		id: `task-${sequence}`,
		name: "task",
		inputHash: "hash",
		attempts: 1,
		state: {
			status: "awaiting_retry",
			error: { name: "Error", message: "task failed" },
			nextAttemptAt: 1,
		},
	})
);

export const failedTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateFailed }>(({ sequence }) => ({
	id: `task-${sequence}`,
	name: "task",
	inputHash: "hash",
	attempts: 1,
	state: { status: "failed", error: { name: "Error", message: "task failed" } },
}));

export const completedTaskInfoFactory = Factory.define<TaskInfo & { state: TaskStateCompleted<unknown> }>(
	({ sequence }) => ({
		id: `task-${sequence}`,
		name: "task",
		inputHash: "hash",
		attempts: 1,
		state: { status: "completed", output: undefined },
	})
);
