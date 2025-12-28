import { event, workflow } from "@aikirun/workflow";

import { drinkCoffee, stretch } from "./task";

export const morningRoutine = workflow({ id: "morning-routine" });

export const morningRoutineV1 = morningRoutine.v("1.0", {
	async handler(input: { sugar: boolean }, run) {
		await drinkCoffee.start(run, { withSugar: input.sugar, withCream: false });
		return "Here's your coffee";
	},
});

export const morningRoutineV2 = morningRoutine.v("2.0", {
	async handler(input: { foo: number }, run) {
		const { data: eventData } = await run.events.alarm.wait();

		run.logger.info("I need to sleep some more");

		await run.sleep({ id: "snooze", seconds: 30 });

		const { muscles } = await stretch.start(run, { duration: input.foo });

		const childHandle = await morningRoutineV1.startAsChild(run, { sugar: true });
		const childResult = await childHandle.waitForStatus("completed");
		if (childResult.success) {
			run.logger.info("Morning routine v1 outpu", {
				cause: childResult.state.output,
			});
		}

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
