import { delay } from "@aikirun/lib";

import { runWithWorker } from "../shared/worker";
import * as cam from "../workflows/cam-divergence";

await runWithWorker([cam.camControlFlowV1], async (client) => {
	client.logger.info("[CAM] Starting: Unsafe Control Flow");
	const handle = await cam.camControlFlowV1.start(client);
	await delay(5_000);
	cam.flags.controlFlow = true;
	await handle.events.proceed.send();
	const result = await handle.waitForStatus("failed");
	const passed = !result.success;
	client.logger.info(`[CAM] Unsafe Control Flow: ${passed ? "PASS" : "FAIL"}`, {
		expected: "failed",
		got: result.success ? "completed" : "failed",
	});
});
