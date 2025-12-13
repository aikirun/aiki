# @aikirun/worker

Worker SDK for Aiki durable execution engine - execute workflows and tasks with durable state management and automatic
recovery.

## Installation

```bash
npm install @aikirun/worker
```

## Quick Start

### Create and Start a Worker

```typescript
import { worker } from "@aikirun/worker";
import { client } from "@aikirun/client";
import { onboardingWorkflowV1 } from "./workflows.ts";

// Initialize client
const aiki = await client({
	url: "http://localhost:9090",
	redis: { host: "localhost", port: 6379 },
});

// Create worker with workflows
const aikiWorker = worker(aiki, {
	id: "worker-1",
	workflows: [onboardingWorkflowV1],
	subscriber: { type: "redis_streams" },
}).withOpts({
	maxConcurrentWorkflowRuns: 10,
});

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

### Params (required for worker identity)

```typescript
interface WorkerParams {
	id: string; // Unique worker ID
	workflows: WorkflowVersion[]; // Workflow versions to execute
	subscriber?: SubscriberStrategy; // Message subscriber (default: redis_streams)
}
```

### Options (runtime tuning via withOpts)

```typescript
interface WorkerOptions {
	maxConcurrentWorkflowRuns?: number; // Concurrency limit (default: 1)
	workflowRun?: {
		heartbeatIntervalMs?: number; // Heartbeat interval (default: 30s)
	};
	gracefulShutdownTimeoutMs?: number; // Shutdown timeout (default: 5s)
	shardKeys?: string[]; // Optional shard keys for distributed work
}
```

## Workflow Registration

Workers receive workflow versions through the `workflows` param:

```typescript
const aikiWorker = worker(aiki, {
	id: "worker-1",
	workflows: [workflowV1, workflowV2, anotherWorkflowV1],
	subscriber: { type: "redis_streams" },
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
- [@aikirun/lib](https://www.npmjs.com/package/@aikirun/lib) - Utility functions

## License

Apache-2.0
