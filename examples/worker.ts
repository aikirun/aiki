import process from "node:process";
import { worker } from "@aikirun/worker";
import { eveningRoutineWorkflow, morningWorkflow, morningWorkflowV1, morningWorkflowV2 } from "./workflows";
import { client } from "../sdk/client/client";

export const aikiClient = await client({
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

export const workerA = worker(aikiClient, {
	id: "worker-A",
	workflows: [morningWorkflow, eveningRoutineWorkflow],
});

const workerB = worker(aikiClient, {
	id: "worker-B",
	workflows: [eveningRoutineWorkflow],
});

const shutdown = async () => {
	await workerA.stop();
	await workerB.stop();
	await aikiClient.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await workerA.start();
await workerB.start();
