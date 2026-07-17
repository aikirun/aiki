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

The claim endpoint atomically fetches and claims ready runs. It also recovers orphaned work by stealing runs whose previous claim has been idle longer than `claimMinIdleTimeMs` (see [Workflow Run Claims](./workflow-run-claims.md)).

### HTTP Subscriber Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `intervalMs` | 1,000 | Poll interval when no work is found (ms) |
| `maxRetryIntervalMs` | 30,000 | Max backoff on errors (ms) |

## Redis Subscriber (Optional)

For sub-second work discovery, install the Redis subscriber:

```package-install
@aikirun/redis
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

When you provide a custom subscriber (including the Redis subscriber), the worker also creates a backup HTTP subscriber. If the primary subscriber fails, the worker switches to the backup to maintain availability. This ensures workflow execution continues even if an external dependency like Redis goes down.

## Next Steps

- **[Workflow Run Claims](./workflow-run-claims.md)** - How runs are owned and recovered
- **[Workers](../core-concepts/workers.md)** - Worker configuration
- **[Overview](./overview.mdx)** - High-level architecture
