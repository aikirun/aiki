import { aiki } from "@aiki/sdk/client";
import { morningRoutingWorkflowV1, morningRoutingWorkflowV2, morningRoutingWorkflowV3 } from "@aiki/sdk/workflow";

if (import.meta.main) {
	const aikiClient = await aiki({url: "localhost:9090"});

	aikiClient.workflow
		.register(morningRoutingWorkflowV1)
		.register(morningRoutingWorkflowV2)
		.register(morningRoutingWorkflowV3);

	aikiClient.listen();

	const workflowRun = await morningRoutingWorkflowV1.run(aikiClient, {
		payload: {a: "1", b: 1},
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000
		}
	});

	const result = await workflowRun.waitForStateSync("completed", {
		maxDurationMs: 10_000
	});
	// deno-lint-ignore no-console
	console.log(`id = ${workflowRun.id}; result = ${result}`);
}