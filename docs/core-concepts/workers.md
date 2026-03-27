# Workers

A worker executes your workflows. It runs in your infrastructure, subscribes to workflow run messages, and executes the workflow logic you've defined. You can run multiple workers to scale horizontally—they automatically share the workload.

## Creating a Worker

```typescript
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";
import { orderWorkflowV1, userWorkflowV1 } from "./workflows";

const aikiClient = client({
  url: "http://localhost:9850",
  apiKey: "your-api-key",
});

const aikiWorker = worker({
  workflows: [orderWorkflowV1, userWorkflowV1],
  options: {
    maxConcurrentWorkflowRuns: 10,
  },
});

const handle = await aikiWorker.spawn(aikiClient);
```

Worker definitions are static and reusable. The `worker()` function creates a definition with a `name` that uniquely identifies the worker and a `workflows` array specifying which workflow versions it can execute. Call `spawn(client)` to begin execution; it returns a handle for controlling the running worker.

## How Workers Operate

When you call `spawn()`, the worker begins discovering ready workflow runs through its subscriber (DB polling by default). When a workflow run is triggered, the worker picks it up, looks up the workflow definition in its registry, and begins execution.

During execution, the worker sends periodic heartbeats to maintain its claim on the run. This prevents other workers from thinking it's stuck. If a worker crashes mid-execution, the claim expires after a configurable idle time (default: 90 seconds). Other workers detect the orphaned work and claim it. The workflow then re-executes from its last checkpoint.

When execution completes successfully or fails in an expected way, the worker acknowledges the run, marking it as processed.

## Scaling

Workers scale naturally. You can add capacity in several ways:

**Run multiple instances** of the same worker to share load. Each gets a portion of the work automatically:

```typescript
const worker1 = worker({ workflows: [orderWorkflowV1] });
const worker2 = worker({ workflows: [orderWorkflowV1] });

const handle1 = await worker1.spawn(aikiClient);
const handle2 = await worker2.spawn(aikiClient);
```

**Specialize workers** by registering different workflows on different workers. Each worker only handles the workflows it knows about.

**Shard by region or tenant** using `shards`. A worker with `shards: ["us-east"]` only processes workflow runs routed to that shard.

## Graceful Shutdown

Always handle shutdown signals to let active workflows complete:

```typescript
process.on("SIGTERM", async () => {
  await handle.stop();
  process.exit(0);
});
```

The `stop()` method on the handle signals the worker to stop accepting new work, waits for active executions to finish (up to `gracefulShutdownTimeoutMs`), then returns. Any workflows that don't complete in time remain unacknowledged and will be claimed by other workers.

## Configuration Reference

Worker configuration is split between **params** (identity) and **options** (tuning).

**Params** are passed directly to `worker()`:

| Param | Description |
|-------|-------------|
| `name` | Unique worker identifier |
| `workflows` | Workflow versions this worker executes |
| `subscriber` | Optional subscriber factory for work discovery (default: DB polling). Use `redisSubscriber()` from `@aikirun/redis` for lower-latency delivery |

**Options** are passed via `options` param or `with()` builder:

| Option | Default | Description |
|--------|---------|-------------|
| `maxConcurrentWorkflowRuns` | 1 | Max parallel executions |
| `gracefulShutdownTimeoutMs` | 5,000 | Shutdown wait time (ms) |
| `workflowRun.heartbeatIntervalMs` | 30,000 | Heartbeat frequency (ms) |
| `shards` | — | Shards to process |

## Pluggable Subscribers

Workers use DB polling by default, which requires no additional setup beyond the Aiki server connection. For lower-latency work discovery, install `@aikirun/redis`:

```bash
npm install @aikirun/redis
```

```typescript
import { redisSubscriber } from "@aikirun/redis";

const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  subscriber: redisSubscriber({ host: "localhost", port: 6379 }),
});
```

You can also implement your own subscriber by providing a function that matches the `CreateSubscriber` type from `@aikirun/types/subscriber`.

## Next Steps

- **[Client](./client.md)** — Connect to Aiki server
- **[Workflows](./workflows.md)** — Define workflow logic
- **[Tasks](./tasks.md)** — Create reusable task units
