import { runWithWorker } from "../shared/worker";
import { childV1, fanOutGatherV1 } from "../workflows/fan-out-gather";

await runWithWorker([childV1, fanOutGatherV1], async (client) => {
	const handle = await fanOutGatherV1.start(client, { items: ["foo", "bar", "baz"] });
	const result = await handle.waitForStatus("completed");
	if (result.success) {
		client.logger.info("Fan-out results", { output: result.state.output });
	}
});
