import { delay } from "@aikirun/lib";

import { runWithWorker } from "../shared/worker";
import { childWorkflowV1, grandparentWorkflowV1, parentWorkflowV1 } from "../workflows/cancellation-cascade";

await runWithWorker([childWorkflowV1, parentWorkflowV1, grandparentWorkflowV1], async (client) => {
	const handle = await grandparentWorkflowV1.start(client);
	// Wait for the hierarchy to start running, then cancel the grandparent
	await delay(10_000);
	await handle.cancel("Testing cancellation cascade");
	client.logger.info("Grandparent cancelled — children should cascade");
});
