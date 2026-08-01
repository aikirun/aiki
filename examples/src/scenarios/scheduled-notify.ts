import { delay } from "@aikirun/lib/async";
import { schedule } from "@aikirun/workflow";

import { runWithWorker } from "../runner";
import { notify } from "../workflows/notify";

const everyTenSeconds = schedule({
	type: "interval",
	every: { seconds: 10 },
	overlapPolicy: "skip",
});

await runWithWorker([notify], async (client) => {
	const scheduleHandle = await everyTenSeconds
		.with()
		.opt("reference.id", "my-correlation-rgwee")
		.opt("workflowRun.retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 })
		.activate(client, notify, "This is a reminder");
	await delay(20_000);
	await scheduleHandle.pause();
});
