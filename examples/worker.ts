import { worker } from "@aiki/worker";
import { client } from "@aiki/client";
import { eveningRoutineWorkflow, morningWorkflow } from "./workflows.ts";
import { delay } from "@aiki/lib/async";

if (import.meta.main) {
	const aikiClient = await client({ url: "http://localhost:3000" });

	const workerA = worker(aikiClient, {
		id: "worker-A",
		subscriber: { type: "polling" },
	});

	const workerB = worker(aikiClient, {
		id: "worker-B",
		subscriber: { type: "adaptive_polling" },
	});

	workerA.workflowRegistry
		.add(morningWorkflow)
		.add(eveningRoutineWorkflow);

	workerB.workflowRegistry
		.add(eveningRoutineWorkflow);

	workerA.start();
	workerB.start();

	await delay(2_000);

	await workerA.stop();
	await workerB.stop();
}
