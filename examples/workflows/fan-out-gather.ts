import { task, workflow } from "@aikirun/workflow";

/**
 * Demonstrates distributed fan-out/gather using child workflows.
 *
 * Each child workflow runs independently across workers.
 * The parent waits for all children, then aggregates results.
 */

const doWork = task({
	name: "do-work",
	async handler(input: { item: string }) {
		return { item: input.item, result: input.item.toUpperCase() };
	},
});

export const childV1 = workflow({ name: "fan-out-child" }).v("1.0.0", {
	async handler(run, input: { item: string }) {
		return doWork.start(run, input);
	},
});

export const fanOutGatherV1 = workflow({ name: "fan-out-gather" }).v("1.0.0", {
	async handler(run, input: { items: string[] }) {
		const handles = await Promise.all(input.items.map((item) => childV1.startAsChild(run, { item })));
		const results = await Promise.all(handles.map((h) => h.waitForStatus("completed")));

		return results.filter((r) => r.success).map((r) => r.state.output);
	},
});
