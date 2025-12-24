import { client } from "@aikirun/client";
import { delay } from "@aikirun/lib";

import { morningWorkflowV2 } from "./definitions/workflow";

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

	const handle = await morningWorkflowV2.start(aikiClient, { foo: 44 });

	await delay(10_000);
	await handle.events.alarm.send({ ringtone: "juba" });

	await delay(10_000);
	await handle.pause();

	await delay(10_000);
	await handle.resume();

	const result = await handle.wait({ type: "status", status: "completed" }, { maxDurationMs: 30_000 });
	if (!result.success) {
		logger.info("Workflow hasn't completed");
		return;
	}

	logger.info("Workflow completed", {
		id: handle.run.id,
		output: result.state.output.bar,
	});
}
