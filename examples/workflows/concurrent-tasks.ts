import { task, workflow } from "@aikirun/workflow";

/**
 * Demonstrates running multiple tasks in concurrent using Promise.all.
 */

const taskA = task({
	name: "task-a",
	async handler() {
		return { a: 1 };
	},
});
const taskB = task({
	name: "task-b",
	async handler() {
		return { b: 2 };
	},
});
const taskC = task({
	name: "task-c",
	async handler() {
		return { c: 3 };
	},
});

export const concurrentTasksV1 = workflow({ name: "parallel-tasks" }).v("1.0.0", {
	async handler(run) {
		const [a, b, c] = await Promise.all([taskA.start(run), taskB.start(run), taskC.start(run)]);

		return { ...a, ...b, ...c };
	},
});
