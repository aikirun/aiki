import { type Task, task } from "./task.ts";

export const ringAlarm: Task<{ song: string }, string> = task({
	name: "ring-alarm",
	run({ payload }) {
		return Promise.resolve(payload.song);
	},
	retry: {
		type: "fixed",
		maxAttempts: 3,
		delayMs: 1_000,
	},
});

export const stretch: Task<{ duration: number }, number> = task({
	name: "stretch",
	run({ payload }) {
		return Promise.resolve(payload.duration);
	},
});

export const drinkCoffee: Task<{ withSugar: boolean }, boolean> = task({
	name: "drink-coffee",
	run({ payload }) {
		return Promise.resolve(payload.withSugar);
	},
});

export const sayPrayer: Task<undefined, void> = task({
	name: "say-prayer",
	run({ payload }) {
		// deno-lint-ignore no-console
		console.log(payload);
		return Promise.resolve();
	},
});
