import { delay } from "@aikirun/lib/async";

import { runWithWorker } from "../shared/worker";
import * as cam from "../workflows/cam-divergence";

await runWithWorker([cam.camInsertV1], async (client) => {
	client.logger.info("[CAM] Starting: Unsafe Insert");
	const handle = await cam.camInsertV1.start(client);
	await delay(5_000);
	cam.flags.insert = true;
	await handle.events.proceed.send();
	const result = await handle.waitForStatus("failed");
	const passed = !result.success;
	client.logger.info(`[CAM] Unsafe Insert: ${passed ? "PASS" : "FAIL"}`, {
		expected: "failed",
		got: result.success ? "completed" : "failed",
	});
});
