import { client } from "@aikirun/client";
import { delay } from "@aikirun/lib";

import { morningRoutineV2 } from "./definitions/workflow";

export const aikiClient = await client({
	url: "http://localhost:9090",
	redis: {
		host: "localhost",
		port: 6379,
	},
});

await runSampleWorkflow();

async function runSampleWorkflow() {
	const { logger } = aikiClient;

	const handle = await morningRoutineV2.start(aikiClient, { foo: 44 });

	await delay(10_000);
	await handle.events.alarm.send({ ringtone: "juba" });

	await delay(10_000);
	await handle.awake();

	const waitResult = await handle.waitForStatus("completed");
	if (waitResult.success) {
		logger.info("Workflow completed", {
			id: handle.run.id,
			bar: waitResult.state.output.bar,
		});
	}
}
