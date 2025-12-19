import { task } from "@aikirun/task";

export const ringAlarm = task({
	id: "ring-alarm",
	handler(input: { song: string }) {
		return Promise.resolve(input.song);
	},
	opts: {
		retry: {
			type: "fixed",
			maxAttempts: 3,
			delayMs: 1_000,
		},
	},
});

export const stretch = task({
	id: "stretch",
	handler(input: { duration: number }) {
		return Promise.resolve(input.duration);
	},
});

export const drinkCoffee = task({
	id: "drink-coffee",
	handler(input: { withSugar: boolean }) {
		return Promise.resolve(input.withSugar);
	},
});

export const sayPrayer = task({
	id: "say-prayer",
	handler() {
		return Promise.resolve();
	},
});
