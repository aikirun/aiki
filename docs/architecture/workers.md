# Worker Architecture

Workers execute workflows in your infrastructure, providing the execution layer for Aiki's distributed system.

## Architecture

```
┌─────────────────────────────────────┐
│           Worker Process            │
│  ┌───────────────────────────────┐  │
│  │   Subscriber Strategy         │  │
│  │   (Redis Streams)             │  │
│  └───────────────┬───────────────┘  │
│                  │                  │
│  ┌───────────────▼───────────────┐  │
│  │   Workflow Execution Engine   │  │
│  │                               │  │
│  │  ┌────────┐  ┌────────────┐   │  │
│  │  │Registry│  │Heartbeat   │   │  │
│  │  └────────┘  └────────────┘   │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Key Components

### Subscriber Strategy

Manages workflow run acquisition:

- **Redis Streams** (currently supported)
  - XREADGROUP for message retrieval
  - XPENDING/XCLAIM for fault tolerance
  - Parallel stream processing
  - Round-robin distribution

### Execution Engine

Handles workflow execution:

1. Load workflow definition from registry
2. Execute tasks in sequence
3. Track progress and state
4. Report results to server
5. Handle errors and retries

### Workflow Registry

Maintains available workflows:

```typescript
worker.workflowRegistry.add(workflow1).add(workflow2);
```

Only workflows in the registry can be executed by this worker.

### Heartbeat System

Monitors worker health:

- Periodic heartbeats to server
- Configurable interval (default: 30s)
- Server detects dead workers
- Enables workflow claiming

## Message Flow

### Retrieving Work

```
1. XREADGROUP from Redis Streams
2. Parse workflow run message
3. Load workflow from registry
4. Begin execution
```

### Claiming Stuck Work

```
1. XPENDING identifies stuck messages
2. Check idle time > claimMinIdleTimeMs
3. XCLAIM to steal message
4. Execute claimed workflow
```

### Parallel Processing

Workers process multiple streams in parallel:

```typescript
// Parallel XREADGROUP across streams
const results = await Promise.allSettled(
  streams.map(stream => readFromStream(stream))
);
```

## Configuration

### Basic Setup

```typescript
const worker = await worker(client, {
  id: "worker-1",
  maxConcurrentWorkflowRuns: 5,
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 60_000,
    blockTimeMs: 1000
  }
});
```

### Advanced Configuration

```typescript
const worker = await worker(client, {
  id: "worker-prod-1",
  maxConcurrentWorkflowRuns: 20,
  subscriber: {
    type: "redis_streams",
    claimMinIdleTimeMs: 30_000,  // Claim after 30s
    blockTimeMs: 2000            // Block 2s for new messages
  },
  workflowRun: {
    heartbeatIntervalMs: 15_000  // Heartbeat every 15s
  },
  gracefulShutdownTimeoutMs: 30_000,  // 30s shutdown timeout
  shardKeys: ["us-east", "us-west"]   // Process specific shards
});
```

## Fault Tolerance

### Message Claiming

When a worker crashes:

1. Other workers detect stuck messages via XPENDING
2. Messages idle > `claimMinIdleTimeMs` are claimed
3. Claimed workflows re-execute from last checkpoint
4. Results are deduplicated by idempotency

### Heartbeat Monitoring

```
Worker → Server: Heartbeat every 30s
Server: Track last heartbeat time
Server: Mark worker dead if heartbeat > 60s old
Other Workers: Claim workflows from dead workers
```

### Graceful Shutdown

```typescript
// Handle SIGTERM
process.on("SIGTERM", async () => {
  await worker.stop();  // Waits for active workflows
  await client.close();
  process.exit(0);
});
```

## Scaling Patterns

### Horizontal Scaling

Add more workers:

```typescript
// Worker 1
const worker1 = await worker(client, { id: "worker-1" });

// Worker 2
const worker2 = await worker(client, { id: "worker-2" });

// Worker 3
const worker3 = await worker(client, { id: "worker-3" });
```

All workers share the workload automatically via consumer groups.

### Specialized Workers

Dedicate workers to specific workflows:

```typescript
// Payment worker
const paymentWorker = await worker(client, { id: "payment-worker" });
paymentWorker.workflowRegistry.add(paymentWorkflow);

// Email worker
const emailWorker = await worker(client, { id: "email-worker" });
emailWorker.workflowRegistry.add(emailWorkflow);
```

### Geographic Distribution

Deploy workers in different regions:

```typescript
// US East worker
const usEastWorker = await worker(client, {
  id: "us-east-worker",
  shardKeys: ["us-east"]
});

// EU worker
const euWorker = await worker(client, {
  id: "eu-worker",
  shardKeys: ["eu-west"]
});
```

## State Management

### Execution State

Workers maintain local state:

```typescript
{
  workflowRunId: "run-123",
  currentTask: "process-payment",
  startedAt: Date.now(),
  heartbeatCount: 42
}
```

### Capacity Management

```typescript
// Track concurrent executions
const activeRuns = new Set();

if (activeRuns.size < maxConcurrentWorkflowRuns) {
  // Accept new workflow
  activeRuns.add(runId);
}
```

## Monitoring

### Worker Metrics

```
aiki_worker_active_workflows
aiki_worker_completed_workflows_total
aiki_worker_failed_workflows_total
aiki_worker_claimed_workflows_total
aiki_worker_heartbeat_failures_total
```

### Health Checks

```typescript
// Worker health endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    workerId: worker.id,
    activeWorkflows: worker.activeCount,
    uptime: process.uptime()
  });
});
```

## Best Practices

1. **Unique Worker IDs** - Use descriptive, unique identifiers
2. **Appropriate Concurrency** - Balance throughput and resource usage
3. **Graceful Shutdown** - Always handle SIGTERM properly
4. **Monitor Health** - Track metrics and heartbeats
5. **Specialize When Needed** - Create dedicated workers for different workloads
6. **Set Claim Times** - Tune `claimMinIdleTimeMs` based on workflow duration

## Next Steps

- **[Redis Streams](./redis-streams.md)** - Message distribution details
- **[Server](./server.md)** - Server architecture
- **[Overview](./overview.md)** - High-level architecture
