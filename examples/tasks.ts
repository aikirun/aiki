import { task } from "@aikirun/task";

export const ringAlarm = task({
	id: "ring-alarm",
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
	id: "stretch",
	exec(input: { duration: number }) {
		return Promise.resolve(input.duration);
	},
});

export const drinkCoffee = task({
	id: "drink-coffee",
	exec(input: { withSugar: boolean }) {
		return Promise.resolve(input.withSugar);
	},
});

export const sayPrayer = task({
	id: "say-prayer",
	exec() {
		return Promise.resolve();
	},
});
