import { task } from "./factory.ts";

export const ringAlarm = task<{song: string}, string>({
	name: "ring-alarm",
	run({payload}) {
		return Promise.resolve(payload.song);
	},
	retry: {
		type: "fixed",
		maxAttempts: 3,
		delayMs: 1_000
	}
});

export const stretch = task<{duration: number}, number>({
	name: "stretch",
	run ({payload}) {
		return Promise.resolve(payload.duration);
	}
});

export const drinkCoffee = task<{withSugar: boolean}, boolean>({
	name: "drink-coffee",
	run ({payload}) {
		return Promise.resolve(payload.withSugar);
	}
});

export const sayPrayer = task({
	name: "say-prayer",
	run ({payload}) {
		console.log(payload);
		return Promise.resolve();
	}
});