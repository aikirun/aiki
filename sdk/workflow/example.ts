import { drinkCoffee, ringAlarm, sayPrayer, stretch } from "../task/example.ts";
import { type Workflow, workflow } from "./definition.ts";

export const morningRoutingWorkflowV1: Workflow<
	{ a: string; b: number },
	{ alarmResult: string; stretchResult: number }
> = workflow({
	name: "morning-routine",
	version: "1.0.0",
	async run({ workflowRun }) {
		const alarmResult = await ringAlarm.run(workflowRun, {
			payload: { song: workflowRun.params.payload.a },
		});

		// TODO: waitfor to 10 days

		const stretchResult = await stretch.run(workflowRun, {
			payload: { duration: workflowRun.params.payload.b },
		});

		return {
			alarmResult,
			stretchResult,
		};
	},
});

export const morningRoutingWorkflowV2: Workflow<{ a: boolean }, void> = workflow({
	name: "morning-routine",
	version: "2.0.0",
	async run({ workflowRun }) {
		await drinkCoffee.run(workflowRun, {
			payload: { withSugar: workflowRun.params.payload.a },
		});
	},
});

export const morningRoutingWorkflowV3: Workflow<undefined, void> = workflow({
	name: "morning-routine",
	version: "3.0.0",
	async run({ workflowRun }) {
		await sayPrayer.run(workflowRun, {});
	},
});
