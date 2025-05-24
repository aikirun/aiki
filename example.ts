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
		.register(morningRoutingWorkflowV1)
		.register(morningRoutingWorkflowV2)
		.register(morningRoutingWorkflowV3);

	workerB.registry
		.register(morningRoutingWorkflowV1)
		.register(morningRoutingWorkflowV2);

	workerA.start();
	workerB.start();

	//triggering a workflow
	const workflowRun = await morningRoutingWorkflowV1.run(client, {
		payload: { a: "1", b: 1 },
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000,
		},
	});

	const result = await workflowRun.waitForStateSync("completed", {
		maxDurationMs: 10_000,
	});
	// deno-lint-ignore no-console
	console.log(`id = ${workflowRun.id}; result = ${result}`);

	await workerA.stop();
	await workerB.stop();
}
