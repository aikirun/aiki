import { task } from "@aikirun/task";

export const drinkCoffee = task({
	id: "drink-coffee",
	handler(_input: { withSugar: boolean }) {
		return Promise.resolve();
	},
});

export const stretch = task({
	id: "stretch",
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
