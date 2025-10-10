import { Aiki } from "@aiki/sdk";
import { eveningRoutineWorkflowV1, morningWorkflowV2 } from "../example.ts";

if (import.meta.main) {
	const client = await Aiki.client({ baseUrl: "localhost:9090" });

	const resultHandle = await morningWorkflowV2.start(client, { a: "1", b: 1 });

	const { result } = await resultHandle.waitForState("completed", {
		maxDurationMs: 10_000,
	});
	// deno-lint-ignore no-console
	console.log(`id = ${resultHandle.id}; result = ${result}`);

	await eveningRoutineWorkflowV1
		.withOptions({ idempotencyKey: "some-key" })
		.start(client);
}
