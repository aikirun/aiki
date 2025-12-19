# Workers

A worker executes your workflows. It runs in your infrastructure, subscribes to workflow run messages, and executes the workflow logic you've defined. You can run multiple workers to scale horizontally—they automatically share the workload. The default subscriber strategy is Redis Streams.

## Creating a Worker

```typescript
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";
import { orderWorkflowV1, userWorkflowV1 } from "./workflows";

const aikiClient = await client({
  url: "localhost:9090",
  redis: { host: "localhost", port: 6379 },
});

const aikiWorker = worker({
  id: "order-worker",
  workflows: [orderWorkflowV1, userWorkflowV1],
  opts: {
    maxConcurrentWorkflowRuns: 10,
  },
});

const handle = await aikiWorker.spawn(aikiClient);
```

Worker definitions are static and reusable. The `worker()` function creates a definition with an `id` that uniquely identifies the worker and a `workflows` array specifying which workflow versions it can execute. Call `spawn(client)` to begin execution—it returns a handle for controlling the running worker.

## How Workers Operate

When you call `spawn()`, the worker subscribes to a stream for each registered workflow. When a workflow run is triggered, a message appears on the stream. The worker picks it up, looks up the workflow definition in its registry, and begins execution.

During execution, the worker sends periodic heartbeats by refreshing its claim on the message. This prevents other workers from thinking it's stuck. If a worker crashes mid-execution, the message remains unacknowledged. After a configurable idle time (default: 3 minutes), other workers detect the orphaned work and claim it. The workflow then re-executes from its last checkpoint.

When execution completes successfully—or fails in an expected way—the worker acknowledges the message, marking it as processed.

## Scaling

Workers scale naturally. You can add capacity in several ways:

**Run multiple instances** of the same worker to share load. Each gets a portion of the work automatically:

```typescript
const worker1 = worker({ id: "worker-1", workflows: [orderWorkflowV1] });
const worker2 = worker({ id: "worker-2", workflows: [orderWorkflowV1] });

const handle1 = await worker1.spawn(aikiClient);
const handle2 = await worker2.spawn(aikiClient);
```

**Specialize workers** by registering different workflows on different workers. Each worker only handles the workflows it knows about.

**Shard by region or tenant** using `shardKeys`. A worker with `shardKeys: ["us-east"]` only processes workflow runs routed to that shard.

## Graceful Shutdown

Always handle shutdown signals to let active workflows complete:

```typescript
process.on("SIGTERM", async () => {
  await handle.stop();
  await aiki.close();
  process.exit(0);
});
```

The `stop()` method on the handle signals the worker to stop accepting new work, waits for active executions to finish (up to `gracefulShutdownTimeoutMs`), then returns. Any workflows that don't complete in time remain unacknowledged and will be claimed by other workers.

## Configuration Reference

Worker configuration is split between **params** (identity) and **options** (tuning).

**Params** are passed directly to `worker()`:

| Param | Description |
|-------|-------------|
| `id` | Unique worker identifier |
| `workflows` | Workflow versions this worker executes |
| `subscriber` | Subscriber config (default: `{ type: "redis_streams" }`) |

**Options** are passed via `opts` param or `with()` builder:

| Option | Default | Description |
|--------|---------|-------------|
| `maxConcurrentWorkflowRuns` | 1 | Max parallel executions |
| `gracefulShutdownTimeoutMs` | 5,000 | Shutdown wait time (ms) |
| `workflowRun.heartbeatIntervalMs` | 30,000 | Heartbeat frequency (ms) |
| `shardKeys` | — | Shards to process |

**Subscriber options** (within `subscriber`):

| Option | Default | Description |
|--------|---------|-------------|
| `claimMinIdleTimeMs` | 180,000 | Idle time before claiming stuck messages |
| `blockTimeMs` | 1,000 | How long to wait for new messages |

## Next Steps

- **[Client](./client.md)** — Connect to Aiki server
- **[Workflows](./workflows.md)** — Define workflow logic
- **[Tasks](./tasks.md)** — Create reusable task units
