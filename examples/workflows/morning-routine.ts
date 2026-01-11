import { task } from "@aikirun/task";
import { event, workflow } from "@aikirun/workflow";

export const morningRoutine = workflow({ name: "morning-routine" });

export const morningRoutineV1 = morningRoutine.v("1.0.0", {
	async handler(run, input: { sugar: boolean }) {
		await makeCoffee.start(run, { withSugar: input.sugar, withCream: false });
		return { coffee: "Here's your coffee" };
	},
});

export const morningRoutineV2 = morningRoutine.v("2.0.0", {
	async handler(run, input: { foo: number }) {
		const { data: eventData } = await run.events.alarm.wait();

		run.logger.info("I need to sleep some more");

		await run.sleep("snooze", { seconds: 30 });

		await yawn.start(run);

		const { muscles } = await stretch.start(run, { duration: input.foo });

		const childHandle = await morningRoutineV1.startAsChild(run, { sugar: true });
		const childResult = await childHandle.waitForStatus("completed");
		if (childResult.success) {
			run.logger.info("Morning routine v1 output", {
				coffee: childResult.state.output.coffee,
			});
		}

		return { summary: `Alarm: ${eventData.ringtone}, Stretched: ${muscles}` };
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

export const makeCoffee = task({
	name: "make-coffee",
	handler(_input: { withSugar: boolean; withCream: boolean }) {
		return Promise.resolve();
	},
});

export const yawn = task({
	name: "yawn",
	async handler() {},
});

export const stretch = task({
	name: "stretch",
	handler(_input: { duration: number }) {
		return Promise.resolve({
			muscles: ["calf", "hamstring", "neck"],
		});
	},
	opts: {
		retry: {
			type: "fixed",
			maxAttempts: 3,
			delayMs: 1_000,
		},
	},
});
