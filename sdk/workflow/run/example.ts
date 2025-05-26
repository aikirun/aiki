import { createClient } from "../../client/definition.ts";
import { morningRoutineWorkflowV1 } from "../example.ts";

if (import.meta.main) {
	const client = await createClient({ url: "localhost:9090" });

	const resultHandle = await morningRoutineWorkflowV1.enqueue(client, {
		payload: { a: "1", b: 1 },
		trigger: {
			type: "delayed",
			delayMs: 60 * 1000,
		},
	});

	const result = await resultHandle.waitForStateSync("completed", {
		maxDurationMs: 10_000,
	});
	// deno-lint-ignore no-console
	console.log(`id = ${resultHandle.id}; result = ${result}`);
}
