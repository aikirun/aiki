import { delay } from "@aikirun/lib";

import { runWithWorker } from "../shared/worker";
import * as cam from "../workflows/cam-divergence";

await runWithWorker([cam.camReorderV1], async (client) => {
	client.logger.info("[CAM] Starting: Safe Reorder");
	const handle = await cam.camReorderV1.start(client);
	await delay(5_000);
	cam.flags.reorder = true;
	await handle.events.proceed.send();
	const result = await handle.waitForStatus("completed");
	const passed = result.success;
	client.logger.info(`[CAM] Safe Reorder: ${passed ? "PASS" : "FAIL"}`, {
		expected: "completed",
		got: result.success ? "completed" : "failed",
	});
});
