import { createClient } from "@aiki/sdk/client";
import { worker } from "@aiki/sdk/worker";
import { morningRoutingWorkflowV1, morningRoutingWorkflowV2, morningRoutingWorkflowV3 } from "@aiki/sdk/workflow";

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
		.add(morningRoutingWorkflowV1)
		.add(morningRoutingWorkflowV2)
		.add(morningRoutingWorkflowV3);

	workerB.registry
		.add(morningRoutingWorkflowV1)
		.add(morningRoutingWorkflowV2);

	workerA.start();
	workerB.start();

	await workerA.stop();
	await workerB.stop();
}
