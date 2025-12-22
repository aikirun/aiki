import { workflow } from "@aikirun/workflow";

import { drinkCoffee, ringAlarm, stretch } from "./task";

export const morningWorkflow = workflow({ id: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0", {
	async handler(input: { a: boolean }, run) {
		await drinkCoffee.start(run, { withSugar: input.a });
	},
});

export const morningWorkflowV2 = morningWorkflow.v("2.0", {
	async handler(input: { a: string; b: number }, run): Promise<{ message: string }> {
		const alarmOutput = await ringAlarm.start(run, { song: input.a });

		run.logger.info("I need to sleep some more");

		await run.sleep({ id: "post-prayer-rest", seconds: 30 });

		const stretchOutput = await stretch.start(run, { duration: input.b });

		return { message: `Alarm: ${alarmOutput}, Stretch: ${stretchOutput}` };
	},
	opts: {
		trigger: {
			type: "delayed",
			delay: { seconds: 5 },
		},
	},
});
