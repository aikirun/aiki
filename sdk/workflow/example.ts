import { workflow } from "@aiki/sdk/workflow";
import { drinkCoffee, ringAlarm, sayPrayer, stretch } from "../task/example.ts";

export const morningWorkflow = workflow({ name: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0", {
	async exec(input: { a: boolean }, run) {
		await drinkCoffee.start(run, { withSugar: input.a });
	},
});

export const morningWorkflowV2 = morningWorkflow
	.v("2.0", {
		async exec(input: { a: string; b: number }, run): Promise<string> {
			const alarmOutput = await ringAlarm.start(run, { song: input.a });

			const stretchOutput = await stretch.start(run, { duration: input.b });

			return `Alarm: ${alarmOutput}, Stretch: ${stretchOutput}`;
		},
	})
	.withOptions({
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000,
		},
	});

export const eveningRoutineWorkflow = workflow({ name: "evening-routine" });

export const eveningRoutineWorkflowV1 = eveningRoutineWorkflow
	.v("1.0.0", {
		async exec(_, run) {
			await sayPrayer.start(run);
		},
	});
