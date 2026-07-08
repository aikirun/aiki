import { delay } from "@aikirun/lib/async";
import { schedule } from "@aikirun/workflow";

import { runWithWorker } from "../runner";
import { notify } from "../workflows/notify";

const everyFiveSeconds = schedule({
	type: "interval",
	every: { seconds: 5 },
	overlapPolicy: "skip",
});

await runWithWorker([notify], async (client) => {
	const scheduleHandle = await everyFiveSeconds
		.with()
		.opt("reference.id", "my-correlation-id")
		.activate(client, notify, "This is a reminder");
	await delay(20_000);
	await scheduleHandle.pause();
});
