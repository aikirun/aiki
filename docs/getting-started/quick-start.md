# Quick Start

Get Aiki running in 5 minutes with this step-by-step guide.

## 1. Install Dependencies

```bash
npm install @aiki/client @aiki/worker @aiki/workflow @aiki/task
```

Make sure you have Redis and the Aiki server running. See [Installation](./installation.md) if you need help with setup.

## 2. Define a Task

Tasks are units of work that can be retried independently:

```typescript
import { task } from "@aiki/task";

const sendEmail = task({
	name: "send-email",
	exec(input: { email: string; message: string }) {
		console.log(`Sending email to ${input.email}`);
		// Your email sending logic here
		return { sent: true, email: input.email };
	},
});
```

## 3. Define a Workflow

Workflows orchestrate multiple tasks:

```typescript
import { workflow } from "@aiki/workflow";

const onboardingWorkflow = workflow({
	name: "user-onboarding",
});

const onboardingV1 = onboardingWorkflow.v("1.0.0", {
	async exec(input: { email: string; name: string }, run) {
		// Execute tasks in sequence
		await sendEmail.start(run, {
			email: input.email,
			message: `Welcome ${input.name}!`,
		});

		return { success: true };
	},
});
```

## 4. Set Up the Client

The client communicates with the Aiki server:

```typescript
import { client } from "@aiki/client";

const aikiClient = await client({
	url: "localhost:9090",
	redis: {
		host: "localhost",
		port: 6379,
	},
});
```

## 5. Create a Worker

Workers execute workflows in your infrastructure:

```typescript
import { worker } from "@aiki/worker";

const aikiWorker = await worker(aikiClient, {
	id: "worker-1",
	maxConcurrentWorkflowRuns: 5,
	subscriber: {
		type: "redis_streams",
		claimMinIdleTimeMs: 60_000,
	},
});

// Register workflows
aikiWorker.workflowRegistry.add(onboardingWorkflow);

// Start processing
await aikiWorker.start();
```

## 6. Start a Workflow

Execute your workflow:

```typescript
const result = await onboardingV1.start(aikiClient, {
	email: "user@example.com",
	name: "Alice",
});

// Wait for completion
const finalResult = await result.waitForCompletion();
console.log("Workflow completed:", finalResult);
```

## Complete Example

Here's the full code:

```typescript
import { client, task, worker, workflow } from "@aiki/sdk";

// 1. Define task
const sendEmail = task({
	name: "send-email",
	exec(input: { email: string; message: string }) {
		console.log(`Sending email to ${input.email}`);
		return { sent: true };
	},
});

// 2. Define workflow
const onboardingWorkflow = workflow({ name: "user-onboarding" });

const onboardingV1 = onboardingWorkflow.v("1.0.0", {
	async exec(input: { email: string; name: string }, run) {
		await sendEmail.start(run, {
			email: input.email,
			message: `Welcome ${input.name}!`,
		});
		return { success: true };
	},
});

// 3. Set up client and worker
const aikiClient = await client({
	url: "localhost:9090",
	redis: { host: "localhost", port: 6379 },
});

const aikiWorker = await worker(aikiClient, {
	id: "worker-1",
	subscriber: { type: "redis_streams" },
});

aikiWorker.workflowRegistry.add(onboardingWorkflow);
await aikiWorker.start();

// 4. Execute workflow
const result = await onboardingV1.start(aikiClient, {
	email: "user@example.com",
	name: "Alice",
});

const finalResult = await result.waitForCompletion();
console.log("Done:", finalResult);
```

## Next Steps

- **[Your First Workflow](./first-workflow.md)** - Build a more complex workflow
- **[Core Concepts](../core-concepts/)** - Learn about workflows, tasks, and workers
- **[Task Determinism](../guides/task-determinism.md)** - Write reliable tasks
