import { worker } from "@aikirun/worker";
import { eveningRoutineWorkflowV1, morningWorkflowV1, morningWorkflowV2 } from "./workflow";

export const workerA = worker({
	id: "worker-A",
	workflows: [morningWorkflowV1, morningWorkflowV2, eveningRoutineWorkflowV1],
	opts: {
		maxConcurrentWorkflowRuns: 10,
	},
});

export const workerB = worker({
	id: "worker-B",
	workflows: [eveningRoutineWorkflowV1],
});
