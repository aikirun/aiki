import { delay } from "@aikirun/lib";

import { runWithWorker } from "../shared/worker";
import { echoV1 } from "../workflows/echo";

await runWithWorker([echoV1], async (client) => {
	const handle = await echoV1.start(client);

	await delay(5_000);
	await handle.events.ping.send({ message: "Ping" });

	await delay(5_000);
	await handle.events.ping.send({ message: "Another Ping" });

	await handle.waitForStatus("completed");
});
