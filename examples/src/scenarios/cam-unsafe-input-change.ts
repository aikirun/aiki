import { delay } from "@aikirun/lib/async";

import { runWithWorker } from "../runner";
import * as cam from "../workflows/cam-divergence";

await runWithWorker([cam.camInputChangeV1], async (client) => {
	client.logger.info("[CAM] Starting: Unsafe Input Change");
	const handle = await cam.camInputChangeV1.start(client);
	await delay(5_000);
	cam.flags.inputChange = true;
	await handle.events.proceed.send();
	const result = await handle.wait();
	const passed = result.state.status === "failed";
	client.logger.info(`[CAM] Unsafe Input Change: ${passed ? "PASS" : "FAIL"}`, {
		expected: "failed",
		got: result.state.status,
	});
});
