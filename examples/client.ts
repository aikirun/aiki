import { client } from "@aiki/client";
import { eveningRoutineWorkflowV1, morningWorkflowV2 } from "./workflows.ts";

if (import.meta.main) {
	const aikiClient = await client({
		url: "http://localhost:9090",
		redis: {
			host: "localhost",
			port: 6379,
		},
		contextFactory: (run) => ({
			traceId: "123456789",
			workflowRunId: run.id,
		}),
	});

	const stateHandle = await morningWorkflowV2.start(aikiClient, { a: "1", b: 1 });

	const { output } = await stateHandle.waitForStatus("completed", { maxDurationMs: 10_000 });
	// deno-lint-ignore no-console
	console.log(`id = ${stateHandle.id}; output = ${output}`);

	await eveningRoutineWorkflowV1
		.withOptions({ idempotencyKey: "some-key" })
		.start(aikiClient);

	await aikiClient.close();
}
