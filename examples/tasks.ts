import { task } from "@aikirun/task";

export const ringAlarm = task({
	name: "ring-alarm",
	exec(input: { song: string }) {
		return Promise.resolve(input.song);
	},
}).withOptions({
	retry: {
		type: "fixed",
		maxAttempts: 3,
		delayMs: 1_000,
	},
});

export const stretch = task({
	name: "stretch",
	exec(input: { duration: number }) {
		return Promise.resolve(input.duration);
	},
});

export const drinkCoffee = task({
	name: "drink-coffee",
	exec(input: { withSugar: boolean }) {
		return Promise.resolve(input.withSugar);
	},
});

export const sayPrayer = task({
	name: "say-prayer",
	exec() {
		return Promise.resolve();
	},
});
