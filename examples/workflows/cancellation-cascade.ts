import { workflow } from "@aikirun/workflow";

/**
 * Demonstrates cancellation cascading through a 3-level hierarchy.
 *
 * grandparent → parent → child
 *
 * Each level sleeps long enough to be cancelled mid-execution.
 * Cancelling the grandparent propagates to parent, then to child.
 */

export const childWorkflowV1 = workflow({ name: "cascade-child" }).v("1.0.0", {
	async handler(run) {
		await run.sleep("child-work", { seconds: 120 });
		return { level: "child" };
	},
});

export const parentWorkflowV1 = workflow({ name: "cascade-parent" }).v("1.0.0", {
	async handler(run) {
		const child = await childWorkflowV1.startAsChild(run);
		await child.waitForStatus("completed");
		return { level: "parent" };
	},
});

export const grandparentWorkflowV1 = workflow({ name: "cascade-grandparent" }).v("1.0.0", {
	async handler(run) {
		const parent = await parentWorkflowV1.startAsChild(run);
		await parent.waitForStatus("completed");
		return { level: "grandparent" };
	},
});
