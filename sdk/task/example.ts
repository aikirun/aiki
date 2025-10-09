import { task } from "@aiki/sdk/task";

export const ringAlarm = task({
	name: "ring-alarm",
	exec(payload: { song: string }) {
		return Promise.resolve(payload.song);
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
	exec(payload: { duration: number }) {
		return Promise.resolve(payload.duration);
	},
});

export const drinkCoffee = task({
	name: "drink-coffee",
	exec(payload: { withSugar: boolean }) {
		return Promise.resolve(payload.withSugar);
	},
});

export const sayPrayer = task({
	name: "say-prayer",
	exec() {
		return Promise.resolve();
	},
});
