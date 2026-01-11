import { client } from "@aikirun/client";
import { delay } from "@aikirun/lib";

import { echoV1 } from "./workflows/echo";
import { morningRoutineV2 } from "./workflows/morning-routine";

export const aikiClient = client({
	url: "http://localhost:9850",
	redis: {
		host: "localhost",
		port: 6379,
	},
});

//#region Echo workflow
const echoHandle = await echoV1.start(aikiClient);

await delay(5_000);
await echoHandle.events.ping.send({ message: "Ping" });
await delay(5_000);
await echoHandle.events.ping.send({ message: "Another Ping" });
await echoHandle.waitForStatus("completed");
//#endregion

//#region Morning routine workflow
const morningRoutineHandle = await morningRoutineV2.start(aikiClient, { foo: 44 });

await delay(5_000);
await morningRoutineHandle.events.alarm.send({ ringtone: "juba" });

await delay(10_000);
await morningRoutineHandle.awake();

const waitResult = await morningRoutineHandle.waitForStatus("completed");
if (waitResult.success) {
	aikiClient.logger.info("Workflow completed", {
		id: morningRoutineHandle.run.id,
		summary: waitResult.state.output.summary,
	});
}
//#endregion
