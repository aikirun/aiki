# Workers

Workers execute workflows in your own infrastructure. They poll for workflow runs, execute tasks, and report results
back to the server.

## Creating a Worker

```typescript
import { worker } from "@aikirun/worker";
import { orderWorkflowV1 } from "./workflows";

const aikiWorker = worker(client, {
	id: "worker-1",
	workflows: [orderWorkflowV1],
	subscriber: {
		type: "redis_streams",
		claimMinIdleTimeMs: 60_000,
		blockTimeMs: 1000,
	},
}).withOpts({
	maxConcurrentWorkflowRuns: 5,
	workflowRun: {
		heartbeatIntervalMs: 30000,
	},
	gracefulShutdownTimeoutMs: 5000,
});
```

## Configuration Options

### id

Unique identifier for the worker. Useful for monitoring and debugging.

```typescript
id: "order-worker-1";
```

### maxConcurrentWorkflowRuns

Maximum number of workflows this worker can execute simultaneously.

```typescript
maxConcurrentWorkflowRuns: 10;
```

### subscriber

Configuration for receiving workflow run notifications.

⚠️ **Note**: Redis Streams is currently the only fully implemented subscriber strategy.

```typescript
subscriber: {
  type: "redis_streams",
  claimMinIdleTimeMs: 60_000,  // Claim stuck messages after 60 seconds
  blockTimeMs: 1000            // Wait 1 second for new messages
}
```

**Options:**

- `claimMinIdleTimeMs` - How long a workflow must be idle before the worker can claim it from a failed worker
- `blockTimeMs` - How long the worker should wait for new workflows before checking again

### workflowRun

Configuration for workflow execution:

```typescript
workflowRun: {
	heartbeatIntervalMs: 30000; // Send heartbeat every 30 seconds
}
```

### gracefulShutdownTimeoutMs

How long to wait for active workflows to complete during shutdown:

```typescript
gracefulShutdownTimeoutMs: 5000; // 5 seconds
```

## Registering Workflows

Workers receive workflows through the `workflows` param. Pass an array of workflow versions:

```typescript
const aikiWorker = worker(client, {
	id: "worker-1",
	workflows: [orderWorkflowV1, userWorkflowV1, notificationWorkflowV1],
	subscriber: { type: "redis_streams" },
});
```

You can register multiple workflow versions to a single worker. Workers will only process workflows in their registry.

## Worker Lifecycle

### Starting the Worker

```typescript
await aikiWorker.start();
```

The `start()` method returns a `Promise<void>` that resolves when the worker stops. The worker runs indefinitely in a
polling loop until `stop()` is called.

### Stopping the Worker

```typescript
await aikiWorker.stop();
```

Gracefully stops the worker, allowing active workflows to complete within the configured timeout.

## How Workers Process Workflows

Workers begin by polling the queue for available workflow runs. Once a run is received, the worker loads the workflow
definition from its registry and executes tasks in sequence while reporting progress. The worker manages retries and
error reporting for failed tasks, then sends the final result to the server upon completion.

## Worker Distribution

You can run multiple workers to scale horizontally:

```typescript
// Worker 1
const worker1 = worker(client, {
	id: "worker-1",
	workflows: [orderWorkflowV1],
	subscriber: { type: "redis_streams" },
}).withOpts({
	maxConcurrentWorkflowRuns: 5,
});

// Worker 2
const worker2 = worker(client, {
	id: "worker-2",
	workflows: [orderWorkflowV1],
	subscriber: { type: "redis_streams" },
}).withOpts({
	maxConcurrentWorkflowRuns: 5,
});

// Both workers process the same workflows
await Promise.all([
	worker1.start(),
	worker2.start(),
]);
```

## Specialized Workers

You can create specialized workers for different workflow types:

```typescript
// Payment worker - handles payment workflows
const paymentWorker = worker(client, {
	id: "payment-worker",
	workflows: [paymentWorkflowV1],
	subscriber: { type: "redis_streams" },
});

// Email worker - handles email workflows
const emailWorker = worker(client, {
	id: "email-worker",
	workflows: [emailWorkflowV1],
	subscriber: { type: "redis_streams" },
});

await Promise.all([
	paymentWorker.start(),
	emailWorker.start(),
]);
```

## Fault Tolerance

Workers provide fault tolerance through:

### Message Claiming

If a worker crashes, other workers can claim its stuck workflows using Redis XPENDING/XCLAIM.

### Heartbeats

Workers send periodic heartbeats to indicate they're alive. Stuck workflows are claimed after `claimMinIdleTimeMs`.

### Automatic Retries

Failed workflows are automatically retried according to the configured strategy.

## Best Practices

1. **Use unique IDs** - Give each worker instance a unique identifier
2. **Set appropriate concurrency** - Balance throughput vs resource usage
3. **Monitor workers** - Track worker health and throughput
4. **Graceful shutdown** - Always await `stop()` to finish active work
5. **Specialize workers** - Create dedicated workers for different workloads

## Example: Complete Worker Setup

```typescript
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";
import { orderWorkflowV1, userWorkflowV1 } from "./workflows";

// Create client
const aiki = await client({
	url: "localhost:9090",
	redis: { host: "localhost", port: 6379 },
});

// Create worker
const aikiWorker = worker(aiki, {
	id: `worker-${process.env.WORKER_ID || 1}`,
	workflows: [orderWorkflowV1, userWorkflowV1],
	subscriber: {
		type: "redis_streams",
		claimMinIdleTimeMs: 60_000,
	},
}).withOpts({
	maxConcurrentWorkflowRuns: 10,
	gracefulShutdownTimeoutMs: 10_000,
});

// Handle shutdown gracefully
process.on("SIGTERM", async () => {
	console.log("Shutting down worker...");
	await aikiWorker.stop();
	await aiki.close();
	process.exit(0);
});

// Start processing
await aikiWorker.start();
```

## Next Steps

- **[Client](./client.md)** - Learn about the Aiki client
- **[Architecture](../architecture/workers.md)** - Worker architecture deep dive
- **[Redis Streams](../architecture/redis-streams.md)** - Message distribution details
