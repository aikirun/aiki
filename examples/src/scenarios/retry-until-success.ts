import { runWithWorker } from "../runner";
import { retryUntilSuccessV1 } from "../workflows/retry-until-success";

await runWithWorker([retryUntilSuccessV1], async (client) => {
	const handle = await retryUntilSuccessV1.start(client);
	const result = await handle.waitForStatus("completed");
	client.logger.info("Retry workflow done", { success: result.success });
});
