import { Aiki } from "@aiki/sdk";
import { morningWorkflowV1 } from "@aiki/sdk/workflow";

if (import.meta.main) {
	const aikiClient = await Aiki.client({ baseUrl: "localhost:9090" });

	const resultHandle = await morningWorkflowV1.enqueue(aikiClient, {
		payload: { a: "1", b: 1 },
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000,
		},
	});

	const { result } = await resultHandle.waitForState("completed", {
		maxDurationMs: 10_000,
	});
	// deno-lint-ignore no-console
	console.log(`id = ${resultHandle.id}; result = ${result}`);
}
