import process from "node:process";

import { aikiWorker } from "./definitions/worker";
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

const workerHandle = await aikiWorker.spawn(aikiClient);

const shutdown = async () => {
	await workerHandle.stop();
	await aikiClient.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
