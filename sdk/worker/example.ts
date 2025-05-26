import { createClient } from "@aiki/sdk/client";
import { worker } from "@aiki/sdk/worker";
import { eveningRoutineWorkflow, morningRoutineWorkflowV1, morningRoutineWorkflowV2 } from "@aiki/sdk/workflow";

if (import.meta.main) {
	const client = await createClient({ url: "localhost:9090" });

	const workerA = await worker(client, {
		id: "worker-a",
		workflowRunSubscriber: {
			pollIntervalMs: 100,
			maxRetryDelayMs: 30_000,
		},
	});
	const workerB = await worker(client, { id: "worker-b" });

	workerA.registry
		.add(morningRoutineWorkflowV1)
		.add(morningRoutineWorkflowV2)
		.add(eveningRoutineWorkflow);

	workerB.registry
		.add(morningRoutineWorkflowV1)
		.add(morningRoutineWorkflowV2);

	workerA.start();
	workerB.start();

	await workerA.stop();
	await workerB.stop();
}
