import { runWithWorker } from "../shared/worker";
import { parallelTasksV1 } from "../workflows/parallel-tasks";

await runWithWorker([parallelTasksV1], async (client) => {
	const handle = await parallelTasksV1.start(client);
	const result = await handle.waitForStatus("completed");
	if (result.success) {
		client.logger.info("Parallel tasks result", result.state.output);
	}
});
