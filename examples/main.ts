import { aiki } from "./setup.ts";
import { eveningRoutineWorkflowV1, morningWorkflowV2 } from "./workflows.ts";

const logger = aiki.logger;

await morningWorkflowV2.start(aiki, { a: "1", b: 1 });

const stateHandle = await eveningRoutineWorkflowV1.withOptions({ idempotencyKey: "some-key" }).start(aiki);

const result = await stateHandle.wait({ type: "status", status: "completed" }, { maxDurationMs: 30_000 });
if (result.success) {
	logger.info("Workflow completed", { id: stateHandle.id });
} else {
	logger.info("Could not get desired state", { cause: result.cause });
}
