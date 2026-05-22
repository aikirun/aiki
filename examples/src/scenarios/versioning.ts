import { runWithWorker } from "../shared/worker";
import { greeterV1, greeterV2 } from "../workflows/versioning";

await runWithWorker([greeterV1, greeterV2], async (client) => {
	// Start both versions simultaneously
	const [h1, h2] = await Promise.all([
		greeterV1.start(client, { name: "Alice" }),
		greeterV2.start(client, { name: "Bob", loud: true }),
	]);

	const [r1, r2] = await Promise.all([h1.waitForStatus("completed"), h2.waitForStatus("completed")]);

	if (r1.success) client.logger.info("v1 result", r1.state.output);
	if (r2.success) client.logger.info("v2 result", r2.state.output);
});
