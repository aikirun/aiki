---
title: Server
---

The Aiki server coordinates workflow execution — and it's a library. `server({ db })` returns two pieces:

- **`handler`** — a fetch-style HTTP handler `(Request) => Promise<Response>` serving the RPC API that clients call. Mount it in any HTTP framework.
- **`runtime`** — background daemons that drive workflow state transitions. Start it with `runtime.start()`.

The bundled standalone server (`app/server`) is a thin composition of this same library — see [Installation](../getting-started/installation.md).

## Request Handling

The RPC API that clients call to:

- **Create workflow runs** — validate input, persist state, queue for execution
- **Update workflow state** — process state transitions from workers
- **Update task state** — record task results and failures
- **Send events** — deliver events to waiting workflows
- **Claim ready runs** — atomically hand ready work to workers
- **Query runs** — list and filter workflow runs

## Work Distribution

When a workflow run becomes ready, the server records it in an **outbox** — the database table that is the source of truth for deliverable work. From there:

- **Default** — workers claim pending runs through the server's claim API. No infrastructure beyond the database.
- **With a publisher configured** (e.g. `@aikirun/redis`) — the runtime also pushes ready runs to per-workflow queues the moment they're due, for sub-second delivery. The outbox remains the recovery path: anything lost in transit is re-published.
- **Endpoints (push)** — the server sends a signed HTTP request to your endpoint handler; no subscriber involved.

See [Subscribers](./subscribers.md) for the worker side of this.

## Background Daemons

The runtime's daemons drive workflow state transitions:

| Daemon | Purpose |
|--------|---------|
| Scheduled runs | Queue scheduled workflow runs when their start time arrives |
| Sleep elapsed | Wake sleeping workflows whose sleep duration has elapsed |
| Workflow retries | Re-queue workflows in `awaiting_retry` when their retry delay expires |
| Task retries | Re-queue workflows whose tasks are awaiting retry |
| Event wait timeouts | Resume workflows that timed out waiting for events |
| Child wait timeouts | Resume workflows that timed out waiting for child workflows |
| Recurring schedules | Create new runs for cron and interval schedules |
| Publish ready runs | Publish pending outbox entries to the work queue |
| Republish stale runs | Re-publish runs whose worker stopped refreshing its claim |
| Due-timers consumer | Fire near-term timers from the timer priority queue (when configured) |

The two publishing daemons run only when a publisher is configured. Without one, workers claim work directly from the outbox, and stale claims are recovered by the claim API itself (see [Workflow Run Claims](./workflow-run-claims.md)).

By default, due work is detected by periodic database scans. Configuring a **timer priority queue** (`@aikirun/redis`) promotes near-term timers into a sorted queue that fires them with sub-second precision.

## Configuration

Embedded, the server is configured by composition:

```typescript
import { database, server } from "@aikirun/server";

const aikiServer = server({
  db: database({ provider: "pg", url: databaseUrl }),
});

const runtimeHandle = aikiServer.runtime.start();
```

Optional pieces plug in the same way — `cache`, `iam` (multi-tenancy and auth), and the Redis-backed runtime adapters:

```typescript
import { redisPublisher, redisTimerPriorityQueue } from "@aikirun/redis";
import { Redis } from "ioredis";

const redis = new Redis({ host: "localhost", port: 6379 });

const aikiServer = server({
  db: database({ provider: "pg", url: databaseUrl }),
  runtime: {
    publisher: redisPublisher(redis),
    timerPriorityQueue: redisTimerPriorityQueue(redis, "aiki:timers"),
  },
});
```

For the bundled standalone server's environment variables, see the [Installation Guide](../getting-started/installation.md).

## Next Steps

- **[Subscribers](./subscribers.md)** - How workers discover work
- **[Runtime Configuration](../guides/configuration.md)** - Tune the server statically or live
- **[Overview](./overview.mdx)** - High-level architecture
