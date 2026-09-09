---
title: Subscribers
description: How workers find work - claiming over HTTP, or push delivery in-process or across instances.
---

Workers discover ready workflow runs through **subscribers**. A subscriber is a pluggable component that controls how a worker finds and claims work. Aiki ships multiple implementations and supports custom ones.

## HTTP Subscriber (Default)

The HTTP subscriber claims ready workflow runs through the Aiki server's claim API. It requires no infrastructure beyond the server itself.

When no subscriber is specified, workers use the HTTP subscriber automatically:

```typescript
const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  // No subscriber specified — uses the HTTP subscriber by default
});
```

The claim endpoint atomically fetches and claims ready runs. Abandoned claims are recovered server-side: after `claimIdleTimeoutMs` without a refresh, the recovery daemon returns the run to the claimable pool (see [Workflow Run Claims](./workflow-run-claims.md)).

### HTTP Subscriber Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `intervalMs` | 1,000 | Poll interval when no work is found (ms) |
| `maxRetryIntervalMs` | 30,000 | Max backoff on errors (ms) |

## In-Memory Subscriber (Optional)

When the worker runs in the same process as the server, `inMemoryQueue()` pairs a publisher and a subscriber over one in-process broker:

```package-install
@aikirun/memory
```

```typescript
import { inMemoryQueue } from "@aikirun/memory";

const queue = inMemoryQueue();

const aikiServer = server({
  db: database({ provider: "pg", url: databaseUrl }),
  runtime: { publisher: queue.publisher },
});

const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  subscriber: queue.subscriber,
});
```

Both halves share one broker object, so both must live in the same process. That is all it asks for — no external service, nothing to connect to, no configuration.

Delivery is shaped exactly like the Redis subscriber below: a queue per workflow version and pool, ordered by when each run became due with priority breaking ties; a publish wakes any worker parked on the queue; and popping a run removes it, so it reaches exactly one worker.

The queues live in the process, so a restart empties them. As with Redis, that costs nothing: the server's database outbox is the source of truth for deliverable work, and anything lost is published again.

## Redis Subscriber (Optional)

When the server and workers run as separate processes, the broker has to be one too. The Redis subscriber delivers the same way across instances:

```package-install
@aikirun/redis
```

```typescript
import { redisSubscriber } from "@aikirun/redis";

const aikiWorker = worker({
  workflows: [orderWorkflowV1],
  subscriber: redisSubscriber({ url: "redis://localhost:6379" }),
});
```

It pairs with the server's Redis publisher — work flows through Redis only if the server is configured to publish there. See [Server](./server.md).

### Queue Per Workflow

Each workflow version gets its own queue — a Redis sorted set ordered by when each run became due, with priority breaking ties between runs due at the same moment:

```
aiki:workflow:user:order-processing:1.0.0
aiki:workflow:user:user-onboarding:1.0.0
```

With worker pools in use:

```
aiki:workflow:user:order-processing:1.0.0:tenant-acme
aiki:workflow:user:order-processing:1.0.0:tenant-globex
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
    heartbeat: {
      send: async (workflowRunId) => { /* ... */ },
      intervalMs: 30_000,
    },
    acknowledge: async (workflowRunId) => { /* ... */ },
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
| `heartbeat` | No | `{ send, intervalMs }` — `send(workflowRunId)` renews an in-flight run in your transport (e.g. extending an SQS visibility timeout), called every `intervalMs` |
| `acknowledge(workflowRunId)` | No | Mark a workflow run as processed in your transport |

If your subscriber blocks inside `getReadyRuns` until work arrives — as the Redis subscriber does — return `0` from `getNextDelay` for `no_work`; the delay between calls only matters for polling subscribers. Give the `retry` variant a real backoff either way: it's applied when `getReadyRuns` fails, and a zero delay there means hammering a failing dependency.

There is no `close` hook. The factory receives a `context` whose `signal` is an `AbortSignal` that fires on worker shutdown; release resources by listening for its `abort` event, as the Redis subscriber does to disconnect.

## Backup Subscriber

When you provide a custom subscriber — the in-memory and Redis subscribers included — the worker also creates a backup HTTP subscriber. If the primary subscriber fails, the worker switches to the backup to maintain availability. This ensures workflow execution continues even if an external dependency like Redis goes down.

## Next Steps

- **[Workflow Run Claims](./workflow-run-claims.md)** - How runs are owned and recovered
- **[Workers](../core-concepts/workers.md)** - Worker configuration
- **[Overview](./overview.mdx)** - High-level architecture
