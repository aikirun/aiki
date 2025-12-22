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

await runWorkflow();

async function runWorkflow() {
	const { logger } = aikiClient;

	const handle = await morningWorkflowV2.start(aikiClient, { a: "xyz", b: 44 });

	const result = await handle.wait({ type: "status", status: "running" }, { maxDurationMs: 30_000 });
	if (!result.success) {
		logger.info("Workflow still not running", { cause: result.cause });
		return;
	}

	logger.info("Workflow running", { id: handle.run.id });

	await delay(2_000);
	await handle.pause();

	await delay(5_000);
	await handle.resume();

	const result2 = await handle.wait({ type: "status", status: "completed" }, { maxDurationMs: 30_000 });
	if (!result2.success) {
		logger.info("Could not get desired state", { cause: result2.cause });
		return;
	}

	logger.info("Workflow completed", {
		id: handle.run.id,
		output: result2.state.output.message,
	});
}
