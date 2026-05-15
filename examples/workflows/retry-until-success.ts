import { task, workflow } from "@aikirun/workflow";

/**
 * Demonstrates task retry. The task fails twice then succeeds on the 3rd attempt.
 */

let tasAttempts = 0;

const unreliableTask = task({
	name: "unreliable-task",
	async handler() {
		tasAttempts++;
		if (tasAttempts <= 2) {
			throw new Error(`Failed (attempt ${tasAttempts})`);
		}
		tasAttempts = 0;
		return { ok: true };
	},
	options: {
		retry: { type: "fixed", maxAttempts: 5, delayMs: 1_000 },
	},
});

let workflowAttempts = 0;

export const retryUntilSuccessV1 = workflow({ name: "retry-until-success" }).v("1.0.0", {
	async handler(run) {
		workflowAttempts++;
		if (workflowAttempts <= 1) {
			throw new Error(`Workflow (attempt ${workflowAttempts})`);
		}
		await unreliableTask.start(run);
	},
	options: {
		retry: { type: "exponential", maxAttempts: Number.MAX_SAFE_INTEGER, baseDelayMs: 500 },
	},
});
