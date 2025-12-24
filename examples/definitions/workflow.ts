import { event, workflow } from "@aikirun/workflow";

import { drinkCoffee, stretch } from "./task";

export const morningWorkflow = workflow({ id: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0", {
	async handler(input: { a: boolean }, run) {
		await drinkCoffee.start(run, { withSugar: input.a });
	},
});

export const morningWorkflowV2 = morningWorkflow.v("2.0", {
	async handler(input: { foo: number }, run): Promise<{ bar: string }> {
		const { data: eventData } = await run.events.alarm.wait();

		run.logger.info("I need to sleep some more");

		await run.sleep({ id: "snooze", seconds: 30 });

		const { muscles } = await stretch.start(run, { duration: input.foo });

		await drinkCoffee.start(run, { withSugar: true });

		return { bar: `Alarm: ${eventData.ringtone}, Stretched: ${muscles}` };
	},
	events: {
		alarm: event<{ ringtone: string }>(),
	},
	opts: {
		trigger: {
			type: "delayed",
			delay: { seconds: 5 },
		},
	},
});
