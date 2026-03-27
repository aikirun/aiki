import { event, task, workflow } from "@aikirun/workflow";

/**
 * Demonstrates durable sleep and human-in-the-loop approval via events.
 *
 * The workflow sleeps durably, then waits for an external approval event
 * before proceeding. Both survive crashes and restarts.
 */

const prepare = task({
	name: "prepare",
	async handler() {
		return { ready: true };
	},
});
const finalize = task({
	name: "finalize",
	async handler(input: { approver: string }) {
		return { done: true, approver: input.approver };
	},
});

export const longRunningPipelineV1 = workflow({ name: "long-running-pipeline" }).v("1.0.0", {
	async handler(run) {
		await prepare.start(run);

		run.logger.info("Sleeping (durable)...");
		await run.sleep("cool-off", { seconds: 30 });

		run.logger.info("Waiting for approval...");
		const approval = await run.events.approve.wait({ timeout: { minutes: 5 } });

		if (approval.timeout) {
			throw new Error("Approval timed out");
		}

		return finalize.start(run, { approver: approval.data.approver });
	},
	events: {
		approve: event<{ approver: string }>(),
	},
});
