import { worker } from "@aiki/sdk/worker";
import { Aiki } from "@aiki/sdk";
import { eveningWorkflow, morningWorkflow } from "../workflow/example.ts";

async function createPollingWorker() {
	const aikiClient = await Aiki.client({ baseUrl: "http://localhost:9090" });

	return worker(aikiClient, {
		id: "polling-worker",
		maxConcurrentWorkflowRuns: 5,
		subscriber: {
			type: "polling",
			intervalMs: 200,
			maxRetryIntervalMs: 10000,
		},
	});
}

async function createAdaptivePollingWorker() {
	const aikiClient = await Aiki.client({ baseUrl: "http://localhost:9090" });

	return worker(aikiClient, {
		id: "adaptive-worker",
		maxConcurrentWorkflowRuns: 10,
		subscriber: {
			type: "adaptive_polling",
			minPollIntervalMs: 50,
			maxPollIntervalMs: 5000,
			backoffMultiplier: 1.5,
			emptyPollThreshold: 3,
			jitterFactor: 0.1,
		},
	});
}

if (import.meta.main) {
	const workerA = await createPollingWorker();
	const workerB = await createAdaptivePollingWorker();

	workerA.workflowRegistry
		.add(morningWorkflow)
		.add(eveningWorkflow);

	workerB.workflowRegistry
		.add(morningWorkflow);

	workerA.start();
	workerB.start();

	await workerA.stop();
	await workerB.stop();
}
