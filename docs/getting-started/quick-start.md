# Quick Start

Build your first workflow in just 5 minutes!

## Prerequisites

Make sure you've completed the [Installation](./installation.md) steps:

- Redis running (see [Installation](./installation.md))
- Aiki Server running (see [Installation](./installation.md))
- SDK packages installed

## Create Your First Workflow File

Create a file called `my-first-workflow.ts`:

```typescript
import { client } from "@aikirun/client";
import { task } from "@aikirun/task";
import { worker } from "@aikirun/worker";
import { workflow } from "@aikirun/workflow";

// 1. Define a task (unit of work)
const greet = task({
	name: "greet",
	async handler(input: { name: string }) {
		console.log(`👋 Hello, ${input.name}!`);
		return { greeted: true, name: input.name };
	},
});

// 2. Define a workflow (orchestrates tasks)
const helloWorkflow = workflow({ name: "hello" });

const helloV1 = helloWorkflow.v("1.0.0", {
	async handler(run, input: { name: string }) {
		const result = await greet.start(run, { name: input.name });
		return { success: true, greeting: result };
	},
});

// 3. Set up the client (connects to Aiki server)
const aikiClient = await client({
	url: "localhost:9876",
	redis: { host: "localhost", port: 6379 },
});

// 4. Create a worker (executes workflows)
const myWorker = worker({ name: "my-worker", workflows: [helloV1] });
const workerHandle = await myWorker.spawn(aikiClient);

// Graceful shutdown
process.on("SIGINT", async () => {
	await workerHandle.stop();
	await aikiClient.close();
});

// 5. Execute your workflow
console.log("Starting workflow...");
const run = await helloV1.start(aikiClient, { name: "Alice" });

// Wait for completion
const result = await run.waitForStatus("completed");
if (result.success) {
	console.log("Workflow result:", result.state.output);
}

// Cleanup
await aikiClient.close();
```

## Run Your Workflow

```bash
# Using Bun
bun run my-first-workflow.ts

# Using Node.js with tsx
npx tsx my-first-workflow.ts
```

## Expected Output

```
Starting workflow...
👋 Hello, Alice!
Workflow result: { success: true, greeting: { greeted: true, name: "Alice" } }
```

Note: By default, `waitForStatus` waits indefinitely. To add a timeout, use:
`await run.waitForStatus("completed", { timeout: { seconds: 60 } })`

## What Just Happened?

1. **Task** - The `greet` function is a reusable unit of work that can be retried independently
2. **Workflow** - The `helloWorkflow` orchestrates when and how tasks run
3. **Client** - Connects to the Aiki server to create and track workflow runs
4. **Worker** - Executes your workflows (typically runs in your infrastructure)
5. **Execution** - You started a workflow run and waited for it to complete

## Key Concepts

- **Durable**: If your server restarts, workflows resume from where they left off
- **Retryable**: Tasks automatically retry on failure
- **Observable**: Each workflow run is tracked and queryable
- **Scalable**: Multiple workers can process workflows in parallel

## Next Steps

- **[Your First Workflow](./first-workflow.md)** - Build a more realistic workflow with multiple tasks and delays
- **[Core Concepts](../core-concepts/)** - Understand workflows, tasks, and workers in depth
- **[Determinism](../guides/determinism.md)** - Learn best practices for reliable workflows
