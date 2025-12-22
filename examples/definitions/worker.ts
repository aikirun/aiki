import { worker } from "@aikirun/worker";

import { morningWorkflowV1, morningWorkflowV2 } from "./workflow";

export const aikiWorker = worker({
	id: "worker-A",
	workflows: [morningWorkflowV1, morningWorkflowV2],
	opts: {
		maxConcurrentWorkflowRuns: 10,
	},
});
