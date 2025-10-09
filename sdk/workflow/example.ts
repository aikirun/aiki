import { workflow } from "@aiki/sdk/workflow";
import { drinkCoffee, ringAlarm, sayPrayer, stretch } from "../task/example.ts";

export const morningWorkflow = workflow({ name: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow
	.v("1.0", {
		async exec(ctx, payload: { a: string; b: number }): Promise<string> {
			const alarmResult = await ringAlarm.start(ctx, { song: payload.a });

			const stretchResult = await stretch.start(ctx, { duration: payload.b });

			return `Alarm: ${alarmResult}, Stretch: ${stretchResult}`;
		},
	})
	.withOptions({
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000,
		},
	});

export const morningWorkflowV2 = morningWorkflow.v("2.0", {
	async exec(ctx, payload: { a: boolean }) {
		await drinkCoffee.start(ctx, { withSugar: payload.a });
	},
});

export const eveningWorkflow = workflow({ name: "evening-routine" });

export const eveningRoutineWorkflowV1 = eveningWorkflow.v("1.0.0", {
	async exec(ctx) {
		await sayPrayer.start(ctx);
	},
});
