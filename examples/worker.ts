import { worker } from "@aiki/worker";
import { client } from "@aiki/client";
import { eveningRoutineWorkflow, morningWorkflow } from "./workflows.ts";
import { processWrapper } from "@aiki/lib/process";

if (import.meta.main) {
	const aikiClient = await client({
		url: "http://localhost:9090",
		redis: {
			host: "localhost",
			port: 6379,
		},
	});

	const workerA = worker(aikiClient, {
		id: "worker-A",
		subscriber: { type: "redis_streams" },
	});

	const workerB = worker(aikiClient, {
		id: "worker-B",
		subscriber: { type: "redis_streams" },
	});

	workerA.workflowRegistry
		.add(morningWorkflow)
		.add(eveningRoutineWorkflow);

	workerB.workflowRegistry
		.add(eveningRoutineWorkflow);

	const shutdown = async () => {
		await workerA.stop();
		await workerB.stop();
		await aikiClient.close();
		processWrapper.exit(0);
	};

	processWrapper.addSignalListener("SIGINT", shutdown);
	processWrapper.addSignalListener("SIGTERM", shutdown);

	await workerA.start();
	await workerB.start();
}
