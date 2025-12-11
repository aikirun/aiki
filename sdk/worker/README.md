# @aikirun/worker

Worker SDK for Aiki durable execution engine - execute workflows and tasks with durable state management and automatic
recovery.

## Installation

```bash
deno add jsr:@aikirun/worker @aikirun/client @aikirun/workflow @aikirun/task
```

## Quick Start

### Create and Start a Worker

```typescript
import { worker } from "@aikirun/worker";
import { client } from "@aikirun/client";
import { onboardingWorkflow } from "./workflows.ts";

// Initialize client
const aiki = await client({
	url: "http://localhost:9090",
	redis: { host: "localhost", port: 6379 },
});

// Create worker
const aikiWorker = worker(aiki, {
	id: "worker-1",
	maxConcurrentWorkflowRuns: 10,
	subscriber: { type: "redis_streams" },
});

// Register workflows
aikiWorker.registry.add(onboardingWorkflow);

// Start worker
await aikiWorker.start();
```

### Graceful Shutdown

```typescript
import process from "node:process";

// Handle signals
const shutdown = async () => {
	await aikiWorker.stop();
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

## Worker Configuration

```typescript
interface WorkerParams {
	id?: string; // Unique worker ID
	maxConcurrentWorkflowRuns?: number; // Concurrency limit (default: 1)
	workflowRun?: {
		heartbeatIntervalMs?: number; // Heartbeat interval (default: 30s)
	};
	gracefulShutdownTimeoutMs?: number; // Shutdown timeout (default: 5s)
	subscriber?: SubscriberStrategy; // Message subscriber (default: redis_streams)
	shardKeys?: string[]; // Optional shard keys for distributed work
}
```

## Workflow Registration

Workers execute workflows registered in their registry:

```typescript
aikiWorker.registry
	.add(workflowV1)
	.add(workflowV2)
	.add(anotherWorkflow);
```

The worker automatically discovers and executes available workflow versions.

## State Persistence

Workers store execution state at each step:

- Task completion status
- Sleep/wait checkpoints
- Event acknowledgments
- Child workflow results

This allows workflows to resume from the exact point of failure.

## Related Packages

- [@aikirun/client](https://jsr.io/@aikirun/client) - Start workflows
- [@aikirun/workflow](https://jsr.io/@aikirun/workflow) - Define workflows
- [@aikirun/task](https://jsr.io/@aikirun/task) - Define tasks
- [@aikirun/lib](https://jsr.io/@aikirun/lib) - Utility functions

## License

Apache-2.0
