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

The subscriber strategy manages workflow run acquisition. Redis Streams is currently supported, using XREADGROUP for
message retrieval, XPENDING/XCLAIM for fault tolerance, parallel stream processing, and round-robin distribution.

### Execution Engine

The execution engine handles workflow execution by loading workflow definitions from the registry, executing tasks in
sequence, tracking progress and state, reporting results to the server, and handling errors and retries.

### Workflow Registry

Workflows are registered via the `workflows` param:

```typescript
const aikiWorker = worker(client, {
	id: "worker-1",
	workflows: [workflowV1, workflowV2],
});
```

Only workflows in the registry can be executed by this worker.

### Heartbeat System

The heartbeat system monitors worker health by sending periodic heartbeats to the server at configurable intervals
(default: 30s). This allows the server to detect dead workers and enables other workers to claim stuck workflows.

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
	streams.map((stream) => readFromStream(stream)),
);
```

## Configuration

### Basic Setup

```typescript
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
});
```

### Advanced Configuration

```typescript
const aikiWorker = worker(client, {
	id: "worker-prod-1",
	workflows: [orderWorkflowV1, paymentWorkflowV1],
	subscriber: {
		type: "redis_streams",
		claimMinIdleTimeMs: 30_000, // Claim after 30s
		blockTimeMs: 2000, // Block 2s for new messages
	},
}).withOpts({
	maxConcurrentWorkflowRuns: 20,
	workflowRun: {
		heartbeatIntervalMs: 15_000, // Heartbeat every 15s
	},
	gracefulShutdownTimeoutMs: 30_000, // 30s shutdown timeout
	shardKeys: ["us-east", "us-west"], // Process specific shards
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
	await worker.stop(); // Waits for active workflows
	await client.close();
	process.exit(0);
});
```

## Scaling Patterns

### Horizontal Scaling

Add more workers:

```typescript
// Worker 1
const worker1 = worker(client, { id: "worker-1", workflows: [orderWorkflowV1] });

// Worker 2
const worker2 = worker(client, { id: "worker-2", workflows: [orderWorkflowV1] });

// Worker 3
const worker3 = worker(client, { id: "worker-3", workflows: [orderWorkflowV1] });
```

All workers share the workload automatically via consumer groups.

### Specialized Workers

Dedicate workers to specific workflows:

```typescript
// Payment worker
const paymentWorker = worker(client, {
	id: "payment-worker",
	workflows: [paymentWorkflowV1],
});

// Email worker
const emailWorker = worker(client, {
	id: "email-worker",
	workflows: [emailWorkflowV1],
});
```

### Geographic Distribution

Deploy workers in different regions:

```typescript
// US East worker
const usEastWorker = worker(client, {
	id: "us-east-worker",
	workflows: [orderWorkflowV1],
}).withOpts({
	shardKeys: ["us-east"],
});

// EU worker
const euWorker = worker(client, {
	id: "eu-worker",
	workflows: [orderWorkflowV1],
}).withOpts({
	shardKeys: ["eu-west"],
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
		uptime: process.uptime(),
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
