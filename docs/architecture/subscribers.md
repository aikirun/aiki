# Subscribers

Workers discover ready workflow runs through **subscribers**. A subscriber is a pluggable component that controls how workers find and claim work. Aiki ships two implementations and supports custom ones.

## DB Subscriber (Default)

The DB subscriber polls the Aiki server API directly for ready workflow runs. It requires no external dependencies beyond the Aiki server itself.

When no subscriber is specified, workers use the DB subscriber automatically:

```typescript
const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  // No subscriber specified — uses DB polling by default
});
```

The DB subscriber calls the server's claim endpoint to atomically fetch and claim ready runs. It handles work stealing by claiming runs that have been idle longer than `claimMinIdleTimeMs`, and sends heartbeats through the API to maintain claims on in-flight runs.

### DB Subscriber Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `intervalMs` | 1,000 | Poll interval (ms) |
| `maxRetryIntervalMs` | 30,000 | Max backoff on retries (ms) |
| `atCapacityIntervalMs` | 500 | Backoff when worker is at max capacity (ms) |
| `claimMinIdleTimeMs` | 90,000 | Claim runs idle longer than this (ms) |

## Redis Subscriber (Optional)

For lower-latency work discovery, install the Redis subscriber:

```bash
npm install @aikirun/redis
```

```typescript
import { redisSubscriber } from "@aikirun/redis";

const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  subscriber: redisSubscriber({
    host: "localhost",
    port: 6379,
  }),
});
```

The Redis subscriber uses Redis Streams for work distribution. This document explains how Aiki leverages streams, not how Redis Streams work (see the [official Redis documentation](https://redis.io/docs/latest/develop/data-types/streams/) for that).

### Stream Per Workflow

Each workflow type gets its own stream:

```
workflow/order-processing/1.0.0
workflow/user-onboarding/1.0.0
workflow/email-sending/2.0.0
```

With sharding enabled:

```
workflow/order-processing/1.0.0/us-east
workflow/order-processing/1.0.0/eu-west
```

### Work Distribution

Workers use consumer groups to receive work:

- When a workflow is started, the server publishes a message to the appropriate stream
- Workers receive messages when they have capacity (automatic load balancing)
- Each message is delivered to exactly one worker in the consumer group
- No central coordinator assigns work; workers pull when ready

### Message Lifecycle

1. Server publishes workflow run message to stream
2. Worker receives message from consumer group
3. Worker executes workflow, sending periodic heartbeats to refresh its claim
4. Worker acknowledges message on completion
5. If worker crashes before acknowledging, message remains pending (heartbeats stop)

### Redis Subscriber Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `claimMinIdleTimeMs` | 90,000 | How long a message must be idle before other workers can claim it |
| `blockTimeMs` | 1,000 | How long to wait for new messages before checking for claimable work |
| `intervalMs` | 50 | Poll interval (ms) |
| `maxRetryIntervalMs` | 30,000 | Max backoff on retries (ms) |
| `atCapacityIntervalMs` | 50 | Backoff when worker is at max capacity (ms) |

## Custom Subscribers

You can implement your own subscriber by providing a function that matches the `CreateSubscriber` type:

```typescript
import type { CreateSubscriber } from "@aikirun/types/subscriber";

const mySubscriber: CreateSubscriber = (context) => {
  return {
    getNextDelay: (params) => 1000,
    getNextBatch: async (size) => {
      // Your work discovery logic here
      return [];
    },
    // Optional:
    heartbeat: async (workflowRunId) => { /* ... */ },
    acknowledge: async (workflowRunId) => { /* ... */ },
    close: async () => { /* ... */ },
  };
};

const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  subscriber: mySubscriber,
});
```

The `Subscriber` interface:

| Method | Required | Description |
|--------|----------|-------------|
| `getNextBatch(size)` | Yes | Fetch up to `size` ready workflow runs |
| `getNextDelay(params)` | Yes | Return milliseconds to wait before next poll |
| `heartbeat(workflowRunId)` | No | Keep an in-flight workflow run's claim alive |
| `acknowledge(workflowRunId)` | No | Mark a workflow run as processed |
| `close()` | No | Cleanup when worker shuts down |

## Fault Tolerance

All subscribers support fault tolerance through heartbeats and work claiming. The mechanism differs by implementation, but the guarantees are the same.

### Heartbeats

While executing a workflow run, the worker sends periodic heartbeats to maintain its claim. If a worker crashes, heartbeats stop and the claim eventually expires.

Heartbeat interval is configured in worker options:

| Option | Default | Description |
|--------|---------|-------------|
| `workflowRun.heartbeatIntervalMs` | 30,000 | How often workers refresh their claim |

### Work Stealing

When a worker crashes mid-execution:

1. The workflow run's claim goes stale (no heartbeats)
2. Other workers detect the idle run (via `claimMinIdleTimeMs`)
3. A healthy worker claims the orphaned run
4. The workflow re-executes from its last checkpoint

The DB subscriber detects idle runs through the server's claim API. The Redis subscriber uses Redis's XCLAIM command to claim messages from pending lists.

### Zombie Worker Prevention

Work stealing assumes the original worker is dead, but what if it's just slow? A worker that was presumed dead might wake up and try to continue executing a workflow run that another worker has already claimed.

Aiki handles this through **revision-based optimistic locking**. Every workflow run has a `revision` counter that increments on each state transition. When a worker transitions a workflow run to running, the revision increments. Every subsequent operation the worker performs — state transitions, task updates — includes the `expectedRevision` it last saw. The server atomically checks that the current revision matches before applying the update.

When Worker B steals a run from Worker A:

1. Worker A holds the run at `revision: 5`
2. Worker B claims the run and transitions it to running, incrementing to `revision: 6`
3. Worker A wakes up and tries to report a task result with `expectedRevision: 5`
4. The server rejects the update — the revision is now `6`
5. Worker A receives a revision conflict error and stops execution cleanly

This check happens at the database level in a single atomic operation (check revision + increment revision + apply update), so there's no race condition window.

### Safe Re-execution

When a claimed workflow re-executes:

- **Tasks return cached results** - Already-completed tasks don't run again
- **State is preserved** - The workflow resumes from its persisted state

Work stealing is safe. Re-executing a workflow doesn't cause duplicate side effects for properly designed tasks.

**Choosing `claimMinIdleTimeMs`**: Set this higher than the heartbeat interval. Workers refresh their claim every heartbeat, so a run only becomes "idle" when a worker stops heartbeating (crashes or hangs). The default of 90 seconds with 30-second heartbeats gives plenty of margin.

### Fallback Subscriber

Workers automatically create a fallback DB subscriber alongside the primary subscriber. If the primary subscriber fails repeatedly (2+ consecutive errors), the worker switches to the DB fallback to maintain availability. This ensures workflow execution continues even if an external dependency like Redis goes down.

## Next Steps

- **[Workers](../core-concepts/workers.md)** - Worker configuration
- **[Overview](./overview.md)** - High-level architecture
