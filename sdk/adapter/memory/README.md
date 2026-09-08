# @aikirun/memory

In-process adapter for Aiki: a publisher/subscriber pair and a timer priority queue backed by in-memory data structures. No external service to run.

## Installation

```bash
npm install @aikirun/memory
```

## Quick Start

Without a timer priority queue, the server finds due work by periodic database scans, so a short sleep waits for the next scan. The in-process queue fires near-term timers when they actually come due:

```typescript
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { database, server } from "@aikirun/server";

const aikiServer = server({
	db: database({ provider: "pg", url: databaseUrl }),
	timerPriorityQueue: inMemoryTimerPriorityQueue(),
});
```

`inMemoryQueue()` returns a publisher and a subscriber over one shared broker, for running a server and its workers in a single process:

```typescript
import { inMemoryQueue } from "@aikirun/memory";
import { database, server } from "@aikirun/server";
import { worker } from "@aikirun/worker";
import { orderWorkflowV1 } from "./workflows.ts";

const queue = inMemoryQueue();

const aikiServer = server({
	db: database({ provider: "pg", url: databaseUrl }),
	runtime: { publisher: queue.publisher },
});

const aikiWorker = worker({ workflows: [orderWorkflowV1], subscriber: queue.subscriber });
```

## Process-local state

Everything here lives in the process that created it, which decides where it fits:

- A publisher and the subscriber that drains it have to be in the same process.
- Timers are not shared between server instances. Each instance arms its own and wakes for every timer it armed, so several instances handle the same timer more than once. Nothing breaks — the database holds every deadline — but the work is duplicated. Use [`@aikirun/redis`](https://www.npmjs.com/package/@aikirun/redis) for a queue that hands each timer to exactly one instance.
- State belongs to the factory, not to the queue it returns. `inMemoryTimerPriorityQueue()` keeps its timers across a server stop and restart in the same process. Both factories expose `clear()` to empty what they hold.

The queue is disposable acceleration state. The database keeps every deadline, and the scans repopulate the queue after a restart.

## Documentation

See the [Server](https://aiki.run/docs/architecture/server) architecture guide.

## License

Apache-2.0
