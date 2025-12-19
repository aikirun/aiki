import process from "node:process";
import { client } from "../sdk/client/client";
import { workerA, workerB } from "./definitions/worker";

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

const workerHandleA = await workerA.spawn(aikiClient);
const workerHandleB = await workerB.spawn(aikiClient);

const shutdown = async () => {
	await workerHandleA.stop();
	await workerHandleB.stop();
	await aikiClient.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
