# @aikirun/worker

Worker SDK for Aiki durable execution platform - execute workflows and tasks with durable state management and automatic
recovery.

## Installation

```bash
npm install @aikirun/worker
```

## Quick Start

### Create and Spawn a Worker

```typescript
import { worker } from "@aikirun/worker";
import { client } from "@aikirun/client";
import { onboardingWorkflowV1 } from "./workflows.ts";

// Define worker
const aikiWorker = worker({
	name: "worker-1",
	workflows: [onboardingWorkflowV1],
	subscriber: { type: "redis" },
	opts: {
		maxConcurrentWorkflowRuns: 10,
	},
});

// Initialize client
const aikiClient = await client({
	url: "http://localhost:9876",
	redis: { host: "localhost", port: 6379 },
});

// Spawn worker
const handle = await aikiWorker.spawn(aiki);
```

### Graceful Shutdown

```typescript
import process from "node:process";

const shutdown = async () => {
	await handle.stop();
	await aiki.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

## Features

- **Durable Execution** - Automatically resume from failures without losing progress
- **Horizontal Scaling** - Multiple workers process workflows in parallel
- **State Management** - Persist execution state at each step
- **Automatic Recovery** - Detect stuck workflows and retry automatically
- **Polling Strategies** - Adaptive polling with configurable backoff
- **Graceful Shutdown** - Clean worker termination with in-flight workflow handling

## Horizontal Scaling

Scale workers by creating separate definitions to isolate workflows or shard by key:

```typescript
// Separate workers by workflow type
const orderWorker = worker({ name: "orders", workflows: [orderWorkflowV1] });
const emailWorker = worker({ name: "emails", workflows: [emailWorkflowV1] });

await orderWorker.spawn(client);
await emailWorker.spawn(client);
```

```typescript
// Shard workers by key (reuse base definition with different shards)
const orderWorker = worker({ name: "order-processor", workflows: [orderWorkflowV1] });

await orderWorker.with().opt("shards", ["us-east", "us-west"]).spawn(client);
await orderWorker.with().opt("shards", ["eu-west"]).spawn(client);
```

## Worker Configuration

### Params (required for worker identity)

```typescript
interface WorkerParams {
	name: string; // Unique worker name
	workflows: WorkflowVersion[]; // Workflow versions to execute
	subscriber?: SubscriberStrategy; // Message subscriber (default: redis)
}
```

### Options (via `opts` param or `with()` builder)

```typescript
interface WorkerOptions {
	maxConcurrentWorkflowRuns?: number; // Concurrency limit (default: 1)
	workflowRun?: {
		heartbeatIntervalMs?: number; // Heartbeat interval (default: 30s)
	};
	gracefulShutdownTimeoutMs?: number; // Shutdown timeout (default: 5s)
	shards?: string[]; // Optional shards for distributed work
}
```

## Workflow Registration

Workers receive workflow versions through the `workflows` param:

```typescript
const aikiWorker = worker({
	name: "worker-1",
	workflows: [workflowV1, workflowV2, anotherWorkflowV1],
	subscriber: { type: "redis" },
});
```

The worker automatically discovers and executes the registered workflow versions.

## State Persistence

Workers store execution state at each step:

- Task completion status
- Sleep/wait checkpoints
- Event acknowledgments
- Child workflow results

This allows workflows to resume from the exact point of failure.

## Related Packages

- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Start workflows
- [@aikirun/workflow](https://www.npmjs.com/package/@aikirun/workflow) - Define workflows
- [@aikirun/task](https://www.npmjs.com/package/@aikirun/task) - Define tasks
- [@aikirun/types](https://www.npmjs.com/package/@aikirun/types) - Type definitions

## Changelog

See the [CHANGELOG](https://github.com/aikirun/aiki/blob/main/CHANGELOG.md) for version history.

## License

Apache-2.0
