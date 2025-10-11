# Workers

Workers execute workflows in your own infrastructure. They poll for workflow runs, execute tasks, and report results back to the server.

## Creating a Worker

```typescript
import { worker } from "@aiki/worker";

const aikiWorker = await worker(client, {
  id: "worker-1",
  maxConcurrentWorkflowRuns: 5,
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 60_000,
    blockTimeMs: 1000
  },
  workflowRun: {
    heartbeatIntervalMs: 30000
  },
  gracefulShutdownTimeoutMs: 5000
});
```

## Configuration Options

### id

Unique identifier for the worker. Useful for monitoring and debugging.

```typescript
id: "order-worker-1"
```

### maxConcurrentWorkflowRuns

Maximum number of workflows this worker can execute simultaneously.

```typescript
maxConcurrentWorkflowRuns: 10
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
- `claimMinIdleTimeMs` - Time before claiming stuck workflows
- `blockTimeMs` - How long to block waiting for new workflows

### workflowRun

Configuration for workflow execution:

```typescript
workflowRun: {
  heartbeatIntervalMs: 30000  // Send heartbeat every 30 seconds
}
```

### gracefulShutdownTimeoutMs

How long to wait for active workflows to complete during shutdown:

```typescript
gracefulShutdownTimeoutMs: 5000  // 5 seconds
```

## Workflow Registry

Workers maintain a registry of workflows they can execute:

```typescript
aikiWorker.workflowRegistry
  .add(orderWorkflow)
  .add(userWorkflow)
  .add(notificationWorkflow);
```

You can register multiple workflows to a single worker. Workers will only process workflows in their registry.

## Worker Lifecycle

### Starting the Worker

```typescript
await aikiWorker.start();
```

The `start()` method returns a `Promise<void>` that resolves when the worker stops. The worker runs indefinitely in a polling loop until `stop()` is called.

### Stopping the Worker

```typescript
await aikiWorker.stop();
```

Gracefully stops the worker, allowing active workflows to complete within the configured timeout.

## How Workers Process Workflows

1. **Poll for work** - Worker polls the queue for available workflow runs
2. **Load definition** - Worker loads the workflow definition from its registry
3. **Execute tasks** - Worker executes tasks in sequence, reporting progress
4. **Handle errors** - Worker manages retries and error reporting
5. **Report completion** - Worker sends final result to the server

## Worker Distribution

You can run multiple workers to scale horizontally:

```typescript
// Worker 1
const worker1 = await worker(client, {
  id: "worker-1",
  maxConcurrentWorkflowRuns: 5,
  subscriber: { type: "redis_streams" }
});
worker1.workflowRegistry.add(orderWorkflow);

// Worker 2
const worker2 = await worker(client, {
  id: "worker-2",
  maxConcurrentWorkflowRuns: 5,
  subscriber: { type: "redis_streams" }
});
worker2.workflowRegistry.add(orderWorkflow);

// Both workers process the same workflows
await Promise.all([
  worker1.start(),
  worker2.start()
]);
```

## Specialized Workers

You can create specialized workers for different workflow types:

```typescript
// Payment worker - handles payment workflows
const paymentWorker = await worker(client, {
  id: "payment-worker",
  subscriber: { type: "redis_streams" }
});
paymentWorker.workflowRegistry.add(paymentWorkflow);

// Email worker - handles email workflows
const emailWorker = await worker(client, {
  id: "email-worker",
  subscriber: { type: "redis_streams" }
});
emailWorker.workflowRegistry.add(emailWorkflow);

await Promise.all([
  paymentWorker.start(),
  emailWorker.start()
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
import { client, worker } from "@aiki/sdk";

// Create client
const aikiClient = await client({
  url: "localhost:9090",
  redis: { host: "localhost", port: 6379 }
});

// Create worker
const aikiWorker = await worker(aikiClient, {
  id: `worker-${process.env.WORKER_ID || 1}`,
  maxConcurrentWorkflowRuns: 10,
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 60_000
  },
  gracefulShutdownTimeoutMs: 10_000
});

// Register workflows
aikiWorker.workflowRegistry
  .add(orderWorkflow)
  .add(userWorkflow);

// Handle shutdown gracefully
process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  await aikiWorker.stop();
  await aikiClient.close();
  process.exit(0);
});

// Start processing
await aikiWorker.start();
```

## Next Steps

- **[Client](./client.md)** - Learn about the Aiki client
- **[Architecture](../architecture/workers.md)** - Worker architecture deep dive
- **[Redis Streams](../architecture/redis-streams.md)** - Message distribution details
