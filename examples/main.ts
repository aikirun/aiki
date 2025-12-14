import { aikiClient } from "./worker";
import { eveningRoutineWorkflowV1, morningWorkflowV2 } from "./workflows";

const { logger } = aikiClient;

await morningWorkflowV2.start(aikiClient, { a: "1", b: 1 });

const handle = await eveningRoutineWorkflowV1.start(aikiClient);

const result = await handle.wait({ type: "status", status: "completed" }, { maxDurationMs: 30_000 });
if (result.success) {
	logger.info("Workflow completed", { id: handle.id });
} else {
	logger.info("Could not get desired state", { cause: result.cause });
}
