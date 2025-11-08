import { loadConfig } from "./config/mod.ts";
import { RPCHandler } from "@orpc/server/fetch";
import { contextFactory } from "./middleware/mod.ts";
import { router } from "./router/mod.ts";
import {
	transitionRetryableWorkflowsToQueued,
	transitionScheduledWorkflowsToQueued,
	transitionSleepingWorkflowsToQueued,
} from "./router/workflow-run.ts";

if (import.meta.main) {
	const config = await loadConfig();

	const rpcHandler = new RPCHandler(router, {
		// onSuccess: async (output, context) => {
		//   console.log('Success:', { output, context });
		// },
		// onError: async (error, context) => {
		//   console.error('Error:', { error, context });
		// },
	});

	const scheduledSchedulerInterval = setInterval(
		() => {
			transitionScheduledWorkflowsToQueued();
		},
		500,
	);

	const sleepingSchedulerInterval = setInterval(
		() => {
			transitionSleepingWorkflowsToQueued();
		},
		500,
	);

	const retrySchedulerInterval = setInterval(
		() => {
			transitionRetryableWorkflowsToQueued();
		},
		1_000,
	);

	Deno.serve({ port: config.port }, async (req) => {
		const context = contextFactory(req);

		const result = await rpcHandler.handle(req, { context });

		return result.response ?? new Response("Not Found", { status: 404 });
	});

	globalThis.addEventListener("beforeunload", () => {
		clearInterval(scheduledSchedulerInterval);
		clearInterval(sleepingSchedulerInterval);
		clearInterval(retrySchedulerInterval);
	});
}
