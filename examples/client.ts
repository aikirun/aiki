import { client } from "@aikirun/client";
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

	const logger = aikiClient.logger;

	await morningWorkflowV2.start(aikiClient, { a: "1", b: 1 });

	const stateHandle = await eveningRoutineWorkflowV1
		.withOptions({ idempotencyKey: "some-key" })
		.start(aikiClient);

	const result = await stateHandle.wait(
		{ type: "status", status: "completed" },
		{ maxDurationMs: 30_000, pollIntervalMs: 5_000 },
	);
	if (result.success) {
		logger.info("Workflow completed", { id: stateHandle.id });
	} else {
		logger.info("Could not get desired state", { cause: result.cause });
	}

	await aikiClient.close();
}
