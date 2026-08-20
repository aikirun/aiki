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
		.with("reference.id", "my-correlation-rgwee")
		.activate(
			client,
			notify.with("retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 }),
			"This is a reminder"
		);
	await delay(20_000);
	await scheduleHandle.pause();
});
