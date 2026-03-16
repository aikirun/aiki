import { delay } from "@aikirun/lib";

import { runWithWorker } from "../shared/worker";
import * as cam from "../workflows/cam-divergence";

await runWithWorker([cam.camAppendV1], async (client) => {
	client.logger.info("[CAM] Starting: Safe Append");
	const handle = await cam.camAppendV1.start(client);
	await delay(5_000);
	cam.flags.append = true;
	await handle.events.proceed.send();
	const result = await handle.waitForStatus("completed");
	const passed = result.success;
	client.logger.info(`[CAM] Safe Append: ${passed ? "PASS" : "FAIL"}`, {
		expected: "completed",
		got: result.success ? "completed" : "failed",
	});
});
