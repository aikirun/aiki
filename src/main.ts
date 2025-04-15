import { workflowExecutor } from "./orchestrator/workflow-executor.ts";
import { aiki } from "./sdk/client/index.ts";
import { morningRoutingWorkflowV1 } from "./sdk/workflow/index.ts";

if (import.meta.main) {
	const client = await aiki({url: "localhost:9090"});

	const workflowRun = await morningRoutingWorkflowV1.run(client, {
		payload: {a: "1", b: 1},
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000
		}
	});
	await workflowExecutor({client});
	const result = await workflowRun.getResult();
	console.log(`id = ${workflowRun.id}; result = ${result}`);
}