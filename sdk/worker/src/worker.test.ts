import { workflow } from "@aikirun/workflow";

import { worker } from "./worker";

const ordersV1 = workflow({ name: "orders" }).v("v1", { handler: async () => {} });

// Compile-time guarantees, never executed. Each `@ts-expect-error` fails the build if its error stops
// being reported, so they hold `WorkerParams.workflows` to workflows a worker can actually run.
function _startConfiguredWorkflowIsNotRegistrable() {
	// @ts-expect-error a worker executes runs it did not start, so a workflow bound to one start is not one it can run
	worker({ workflows: [ordersV1.with("trigger", { type: "delayed", delay: { seconds: 5 } })] });

	worker({ workflows: [ordersV1.with("pool", "gpu")] });
}
