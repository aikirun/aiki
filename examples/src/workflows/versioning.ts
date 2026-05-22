import { task, workflow } from "@aikirun/workflow";

/**
 * Demonstrates workflow versioning.
 *
 * Two versions of the same workflow can run simultaneously.
 * Each version has its own handler, so deployments are safe —
 * in-flight v1 runs continue with v1 code while new runs use v2.
 */

const greet = task({
	name: "greet",
	async handler(input: { name: string }) {
		return { message: `Hello, ${input.name}` };
	},
});

export const greeter = workflow({ name: "greeter" });

export const greeterV1 = greeter.v("1.0.0", {
	async handler(run, input: { name: string }) {
		return greet.start(run, { name: input.name });
	},
});

export const greeterV2 = greeter.v("2.0.0", {
	async handler(run, input: { name: string; loud: boolean }) {
		const result = await greet.start(run, { name: input.name });
		return { message: input.loud ? result.message.toUpperCase() : result.message };
	},
});
