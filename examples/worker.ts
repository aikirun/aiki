import process from "node:process";
import { worker } from "@aikirun/worker";
import { eveningRoutineWorkflowV1, morningWorkflowV1, morningWorkflowV2 } from "./workflows";
import { client } from "../sdk/client/client";

const workerA = worker({
	id: "worker-A",
	workflows: [morningWorkflowV1, morningWorkflowV2, eveningRoutineWorkflowV1],
	opts: {
		maxConcurrentWorkflowRuns: 10,
	},
});

const workerB = worker({
	id: "worker-B",
	workflows: [eveningRoutineWorkflowV1],
});

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

const workerHandleA = await workerA.start(aikiClient);
const workerHandleB = await workerB.start(aikiClient);

const shutdown = async () => {
	await workerHandleA.stop();
	await workerHandleB.stop();
	await aikiClient.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
