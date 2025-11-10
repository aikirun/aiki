import { worker } from "@aikirun/worker";
import { eveningRoutineWorkflow, morningWorkflow } from "./workflows.ts";
import { processWrapper } from "@aikirun/lib/process";
import { aiki } from "./client.ts";

export const workerA = worker(aiki, {
	id: "worker-A",
	subscriber: { type: "redis_streams" },
});

const workerB = worker(aiki, {
	id: "worker-B",
	subscriber: { type: "redis_streams" },
});

workerA.registry
	.add(morningWorkflow)
	.add(eveningRoutineWorkflow);

workerB.registry
	.add(eveningRoutineWorkflow);

const shutdown = async () => {
	await workerA.stop();
	await workerB.stop();
	await aiki.close();
	processWrapper.exit(0);
};

processWrapper.addSignalListener("SIGINT", shutdown);
processWrapper.addSignalListener("SIGTERM", shutdown);

await workerA.start();
await workerB.start();
