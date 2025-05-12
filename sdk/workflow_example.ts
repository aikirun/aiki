import { drinkCoffee, ringAlarm, sayPrayer, stretch } from "./task_example.ts";
import { workflow } from "./workflow.ts";

export const morningRoutingWorkflowV1 = workflow<{a: string; b: number}, {alarmResult: string, stretchResult: number}>({
	name: "morning-routine",
	version: "1.0.0",
	async run({workflowRun}) {
		const alarmResult = await ringAlarm.run(workflowRun, {
			payload: {song: workflowRun.params.payload.a}
		});
		const stretchResult = await stretch.run(workflowRun, {
			payload: {duration: workflowRun.params.payload.b}
		});

		return {
			alarmResult,
			stretchResult
		};
	}
});

export const morningRoutingWorkflowV2 = workflow<{a: boolean}, void>({
	name: "morning-routine",
	version: "2.0.0",
	async run({workflowRun}) {
		await drinkCoffee.run(workflowRun, {
			payload: {withSugar: workflowRun.params.payload.a}
		});
	}
});

export const morningRoutingWorkflowV3 = workflow({
	name: "morning-routine",
	version: "3.0.0",
	async run({workflowRun}) {
		await sayPrayer.run(workflowRun, {});
	}
});