import { workflow } from "@aiki/sdk/workflow";
import { drinkCoffee, ringAlarm, sayPrayer, stretch } from "../task/example.ts";

export const morningWorkflow = workflow({ name: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0", {
	async exec(input: { a: boolean }, run) {
		await drinkCoffee.start(run, { withSugar: input.a });
	},
});

interface AppContext {
	traceId: string;
	workflowRunId: string;
}

export const morningWorkflowV2 = morningWorkflow
	.v("2.0", {
		async exec(input: { a: string; b: number }, run, context: AppContext): Promise<string> {
			run.logger.info("Starting morning routine", { song: input.a, duration: input.b, traceId: context.traceId });

			const alarmOutput = await ringAlarm.start(run, { song: input.a });
			run.logger.debug("Alarm completed", { output: alarmOutput });

			const stretchOutput = await stretch.start(run, { duration: input.b });
			run.logger.debug("Stretch completed", { output: stretchOutput });

			const result = `Alarm: ${alarmOutput}, Stretch: ${stretchOutput}`;
			run.logger.info("Morning routine completed", { result });

			return result;
		},
	})
	.withOptions({
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000,
		},
	});

export const eveningRoutineWorkflow = workflow({ name: "evening-routine" });

export const eveningRoutineWorkflowV1 = eveningRoutineWorkflow
	.v("1.0.0", {
		async exec(_, run, _context: AppContext) {
			await sayPrayer.start(run);
		},
	});
