import process from "node:process";
import { worker } from "@aikirun/worker";

import { echoV1 } from "./workflows/echo";
import { morningRoutineV1, morningRoutineV2 } from "./workflows/morning-routine";
import { notify } from "./workflows/notify";
import { client } from "../sdk/client/client";

export const workerA = worker({
	name: "worker-A",
	workflows: [echoV1, morningRoutineV1, morningRoutineV2, notify],
	opts: {
		maxConcurrentWorkflowRuns: 10,
	},
});

export const aikiClient = client({
	url: "http://localhost:9850",
	redis: {
		host: "localhost",
		port: 6379,
	},
	createContext: (run) => ({
		traceId: "123456789",
		workflowRunId: run.id,
	}),
});

const workerHandle = await workerA.spawn(aikiClient);

const shutdown = async () => {
	await workerHandle.stop();
	await aikiClient.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
