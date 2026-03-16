import { runWithWorker } from "../shared/worker";
import { delayedStartV1 } from "../workflows/delayed-start";

await runWithWorker([delayedStartV1], async (client) => {
	const startedAt = Date.now();
	client.logger.info("Starting delayed workflow...");

	const handle = await delayedStartV1.start(client);
	const result = await handle.waitForStatus("completed");

	if (result.success) {
		const elapsed = Date.now() - startedAt;
		client.logger.info("Delayed workflow completed", { elapsedMs: elapsed, output: result.state.output });
	}
});
