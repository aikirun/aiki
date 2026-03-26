import { task } from "@aikirun/task";
import { workflow } from "@aikirun/workflow";

/**
 * Demonstrates task retry. The task fails twice then succeeds on the 3rd attempt.
 */

let attempts = 0;

const unreliableTask = task({
	name: "unreliable-task",
	async handler() {
		attempts++;
		if (attempts <= 2) {
			throw new Error(`Failed (attempt ${attempts})`);
		}
		attempts = 0;
		return { ok: true };
	},
	options: {
		retry: { type: "fixed", maxAttempts: 5, delayMs: 1_000 },
	},
});

export const retryUntilSuccessV1 = workflow({ name: "retry-until-success" }).v("1.0.0", {
	async handler(run) {
		return unreliableTask.start(run);
	},
});
