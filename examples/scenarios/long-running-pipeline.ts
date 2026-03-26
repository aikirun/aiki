import { delay } from "@aikirun/lib/async";

import { runWithWorker } from "../shared/worker";
import { longRunningPipelineV1 } from "../workflows/long-running-pipeline";

await runWithWorker([longRunningPipelineV1], async (client) => {
	const handle = await longRunningPipelineV1.start(client, {
		dataUrl: "https://example.com/data.csv",
	});
	// Wait for it to reach the approval stage, then approve
	await delay(35_000);
	await handle.events.approve.send({ approver: "admin@example.com" });
	const result = await handle.waitForStatus("completed");
	if (result.success) {
		client.logger.info("Pipeline complete", result.state.output);
	}
});
