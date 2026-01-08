import { client } from "@aikirun/client";
import { task } from "@aikirun/task";
import { worker } from "@aikirun/worker";
import { workflow } from "@aikirun/workflow";

// 1. Define a task (unit of work)
const greet = task({
	name: "greet",
	async handler(input: { name: string }) {
		return { greeting: `👋 Hello, ${input.name}!` };
	},
});

// 2. Define a workflow (orchestrates tasks)
const helloWorkflow = workflow({ name: "hello" });

const helloV1 = helloWorkflow.v("1.0.0", {
	async handler(run, input: { name: string }) {
		const { greeting } = await greet.start(run, { name: input.name });
		run.logger.info(greeting);
		return { message: `I said hello to ${input.name}` };
	},
});

// 3. Set up the client (connects to Aiki server)
const aikiClient = await client({
	url: "http://localhost:9876",
	redis: { host: "localhost", port: 6379 },
});

// 4. Create a worker (executes workflows)
const myWorker = worker({ name: "my-worker", workflows: [helloV1] });
const workerHandle = await myWorker.spawn(aikiClient);

// 5. Execute your workflow
const workflowHandle = await helloV1.start(aikiClient, { name: "Alice" });

// Wait for completion
const result = await workflowHandle.waitForStatus("completed");
if (result.success) {
	aikiClient.logger.info(result.state.output.message);
}

// Cleanup
await workerHandle.stop();
await aikiClient.close();
