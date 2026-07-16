---
title: Subscribers
---

Workers discover ready workflow runs through **subscribers**. A subscriber is a pluggable component that controls how a worker finds and claims work. Aiki ships two implementations and supports custom ones.

## HTTP Subscriber (Default)

The HTTP subscriber claims ready workflow runs through the Aiki server's claim API. It requires no infrastructure beyond the server itself.

When no subscriber is specified, workers use the HTTP subscriber automatically:

```typescript
const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  // No subscriber specified — uses the HTTP subscriber by default
});
```

The claim endpoint atomically fetches and claims ready runs. It also recovers orphaned work by claiming runs that have been idle longer than `claimMinIdleTimeMs` (see [Fault Tolerance](#fault-tolerance)).

### HTTP Subscriber Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `intervalMs` | 1,000 | Poll interval when no work is found (ms) |
| `maxRetryIntervalMs` | 30,000 | Max backoff on errors (ms) |
| `claimMinIdleTimeMs` | 90,000 | Claim runs idle longer than this (ms) |

## Redis Subscriber (Optional)

For sub-second work discovery, install the Redis subscriber:

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

It pairs with the server's Redis publisher — work flows through Redis only if the server is configured to publish there. See [Server](./server.md).

### Queue Per Workflow

Each workflow version gets its own queue — a Redis sorted set ordered by when each run became due, with priority breaking ties between runs due at the same moment:

```
aiki:workflow:order-processing:1.0.0
aiki:workflow:user-onboarding:1.0.0
```

With sharding enabled:

```
aiki:workflow:order-processing:1.0.0:us-east
aiki:workflow:order-processing:1.0.0:eu-west
```

### Work Distribution

- When a workflow run becomes ready, the server publishes it to the matching queue
- Workers block on their queues, so work is delivered the moment it's published — no idle polling
- Popping a run removes it from the queue, so each run is delivered to exactly one worker
- After the first pop, remaining worker capacity is filled round-robin across queues, so busy workflows don't starve quiet ones

Queue contents are disposable. The server's database outbox is the source of truth for deliverable work; if Redis goes down, the server re-publishes anything lost once it recovers, and the worker fails over to its backup subscriber in the meantime (see [Backup Subscriber](#backup-subscriber)).

### Redis Subscriber Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `maxRetryIntervalMs` | 30,000 | Max backoff on connection errors (ms) |

## Custom Subscribers

You can implement your own subscriber by providing a function that matches the `CreateSubscriber` type:

```typescript
import type { CreateSubscriber } from "@aikirun/types/infra/queue";

const mySubscriber: CreateSubscriber = (context) => {
  return {
    getNextDelay: (params) => 1000,
    getReadyRuns: async (limit) => {
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
| `getReadyRuns(limit)` | Yes | Fetch up to `limit` ready workflow runs; may block until work arrives |
| `getNextDelay(params)` | Yes | Return milliseconds to wait before the next call (`no_work` or `retry`) |
| `heartbeat(workflowRunId)` | No | Keep an in-flight run's claim alive in your transport (e.g. extending an SQS visibility timeout) |
| `acknowledge(workflowRunId)` | No | Mark a workflow run as processed in your transport |
| `close()` | No | Cleanup when the worker shuts down |

If your subscriber blocks inside `getReadyRuns` until work arrives — as the Redis subscriber does — return `0` from `getNextDelay` for `no_work`; the delay between calls only matters for polling subscribers. Give the `retry` variant a real backoff either way: it's applied when `getReadyRuns` fails, and a zero delay there means hammering a failing dependency.

## Fault Tolerance

Crashed or stuck workers don't strand workflow runs. Recovery is driven by the server and works the same regardless of subscriber.

### Heartbeats

While executing a workflow run, the worker sends periodic heartbeats to the server to keep its claim alive. If the worker crashes, heartbeats stop and the claim eventually goes stale.

Heartbeat interval is configured in worker options:

| Option | Default | Description |
|--------|---------|-------------|
| `workflowRun.heartbeatIntervalMs` | 30,000 | How often workers refresh their claim |

If a custom subscriber provides its own `heartbeat` method, the worker calls both — the server's and the subscriber's.

### Work Stealing

When a worker crashes mid-execution:

1. The workflow run's claim goes stale (no heartbeats)
2. After `claimMinIdleTimeMs`, the run is up for grabs again — the claim API hands it to the next claiming worker, and when a publisher is configured, the server's republish daemon also puts it back on the queue
3. A healthy worker picks up the orphaned run
4. The workflow re-executes from its last checkpoint

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

### Backup Subscriber

When you provide a custom subscriber (including the Redis subscriber), the worker also creates a backup HTTP subscriber. If the primary subscriber fails, the worker switches to the backup to maintain availability. This ensures workflow execution continues even if an external dependency like Redis goes down.

## Next Steps

- **[Workers](../core-concepts/workers.md)** - Worker configuration
- **[Overview](./overview.mdx)** - High-level architecture
