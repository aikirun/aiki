import { task } from "@aikirun/task";
import { workflow } from "@aikirun/workflow";

/**
 * Demonstrates delayed workflow trigger.
 *
 * The workflow is scheduled but doesn't start executing until
 * after the configured delay. Useful for deferred processing.
 */

const doWork = task({
	name: "delayed-work",
	async handler() {
		return { done: true, at: Date.now() };
	},
});

export const delayedStartV1 = workflow({ name: "delayed-start" }).v("1.0.0", {
	async handler(run) {
		return doWork.start(run);
	},
	opts: {
		trigger: { type: "delayed", delay: { seconds: 5 } },
	},
});
