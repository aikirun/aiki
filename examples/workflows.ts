import { workflow } from "@aikirun/workflow";
import { drinkCoffee, ringAlarm, sayPrayer, stretch } from "./tasks";

export const morningWorkflow = workflow({ id: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0", {
	async exec(input: { a: boolean }, run) {
		await drinkCoffee.start(run, { withSugar: input.a });
	},
});

interface AppContext {
	traceId: string;
	workflowRunId: string;
}

export const morningWorkflowV2 = morningWorkflow.v("2.0", {
	async exec(input: { a: string; b: number }, run, context: AppContext): Promise<string> {
		run.logger.info("Starting morning routine", { song: input.a, duration: input.b, traceId: context.traceId });

		const alarmOutput = await ringAlarm.start(run, { song: input.a });

		const stretchOutput = await stretch.start(run, { duration: input.b });

		const response = `Alarm: ${alarmOutput}, Stretch: ${stretchOutput}`;

		run.logger.info("Morning routine completed", { response });

		return response;
	},
	opts: {
		trigger: {
			type: "delayed",
			delay: { seconds: 5 },
		},
	},
});

export const eveningRoutineWorkflow = workflow({ id: "evening-routine" });

export const eveningRoutineWorkflowV1 = eveningRoutineWorkflow.v("1.0.0", {
	async exec(_, run, _context: AppContext) {
		await sayPrayer.start(run);
		await run.sleep({ seconds: 5 });
	},
});
