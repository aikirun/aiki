import { runWithWorker } from "../shared/worker";
import { concurrentTasksV1 } from "../workflows/concurrent-tasks";

await runWithWorker([concurrentTasksV1], async (client) => {
	const handle = await concurrentTasksV1.start(client);
	const result = await handle.waitForStatus("completed");
	if (result.success) {
		client.logger.info("Concurrent tasks result", result.state.output);
	}
});
