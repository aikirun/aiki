import { notify } from "examples/workflows/notify";

import { runWithWorker } from "../shared/worker";

await runWithWorker([notify], async (client) => {
	const startedAt = Date.now();
	client.logger.info("Starting delayed workflow...");

	const handle = await notify
		.with()
		.opt("trigger", { type: "delayed", delay: { seconds: 5 } })
		.start(client, "It's a good day");
	const result = await handle.waitForStatus("completed");

	if (result.success) {
		const elapsed = Date.now() - startedAt;
		client.logger.info("Delayed workflow completed", { elapsedMs: elapsed, output: result.state.output });
	}
});
