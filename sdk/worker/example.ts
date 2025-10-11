import { worker } from "@aiki/sdk/worker";
import { Aiki } from "@aiki/sdk";
import { eveningRoutineWorkflow, morningWorkflow } from "../workflow/example.ts";

if (import.meta.main) {
	const client = await Aiki.client({ url: "http://localhost:3000" });

	const workerA = worker(client, {
		id: "worker-A",
		subscriber: { type: "polling" },
	});

	const workerB = worker(client, {
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

	await workerA.stop();
	await workerB.stop();
}
