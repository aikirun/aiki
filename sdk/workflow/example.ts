import { workflow } from "@aiki/sdk/workflow";
import { drinkCoffee, ringAlarm, sayPrayer, stretch } from "../task/example.ts";

export const morningWorkflow = workflow({ name: "morning-routine" });

export const morningWorkflowV1 = morningWorkflow.v("1.0", {
	async exec(input: { a: boolean }, run) {
		await drinkCoffee.start(run, { withSugar: input.a });
	},
});

export const morningWorkflowV2 = morningWorkflow
	.v("2.0", {
		async exec(
			input: { a: string; b: number },
			run,
			deps: { db: DatabaseConnection; email: EmailService },
		): Promise<string> {
			const alarmOutput = await ringAlarm.start(run, { song: input.a });

			const stretchOutput = await stretch.start(run, { duration: input.b });

			await deps.db.query("SELECT * FROM TABLE");
			await deps.email.send("info@aiki.com", "It's dawn!");

			return `Alarm: ${alarmOutput}, Stretch: ${stretchOutput}`;
		},
	})
	.withOptions({
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000,
		},
	});

export interface DatabaseConnection {
	query: <T>(sql: string) => Promise<T[]>;
}

export interface EmailService {
	send: (to: string, message: string) => Promise<void>;
}

export const eveningRoutineWorkflowV1 = workflow({ name: "evening-routine" })
	.v("1.0.0", {
		async exec(_, run) {
			await sayPrayer.start(run);
		},
	});
