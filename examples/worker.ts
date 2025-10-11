import { worker } from "@aiki/worker";
import { client } from "@aiki/client";
import { eveningRoutineWorkflow, morningWorkflow } from "./workflows.ts";
import { delay } from "@aiki/lib/async";

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

	await workerA.start();
	await workerB.start();

	await delay(5_000);

	await workerA.stop();
	await workerB.stop();

	await aikiClient.close();
}
