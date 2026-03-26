import { delay } from "@aikirun/lib/async";

import { runWithWorker } from "../shared/worker";
import * as cam from "../workflows/cam-divergence";

await runWithWorker([cam.camRemovalV1], async (client) => {
	client.logger.info("[CAM] Starting: Safe Removal");
	const handle = await cam.camRemovalV1.start(client);
	await delay(5_000);
	cam.flags.removal = true;
	await handle.events.proceed.send();
	const result = await handle.waitForStatus("completed");
	const passed = result.success;
	client.logger.info(`[CAM] Safe Removal: ${passed ? "PASS" : "FAIL"}`, {
		expected: "completed",
		got: result.success ? "completed" : "failed",
	});
});
