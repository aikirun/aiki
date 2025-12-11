import process from "node:process";
import { worker } from "@aikirun/worker";
import { eveningRoutineWorkflow, morningWorkflow } from "./workflows.ts";
import { client } from "../sdk/client/client.ts";

export const aiki = await client({
	url: "http://localhost:9090",
	redis: {
		host: "localhost",
		port: 6379,
	},
	contextFactory: (run) => ({
		traceId: "123456789",
		workflowRunId: run.id,
	}),
});

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
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await workerA.start();
await workerB.start();
