import { worker } from "@aikirun/worker";

import { morningRoutineV1, morningRoutineV2 } from "./workflow";

export const workerA = worker({
	name: "worker-A",
	workflows: [morningRoutineV1, morningRoutineV2],
	opts: {
		maxConcurrentWorkflowRuns: 10,
	},
});
