# @aikirun/redis

Redis adapter for Aiki: sub-second work delivery for workers via Redis Streams, plus a timer priority queue and cache for the server runtime.

## Installation

```bash
npm install @aikirun/redis
```

## Quick Start

```typescript
import { redisSubscriber } from "@aikirun/redis";
import { worker } from "@aikirun/worker";
import { orderWorkflowV1 } from "./workflows.ts";

const aikiWorker = worker({
	workflows: [orderWorkflowV1],
	subscriber: redisSubscriber({ host: "localhost", port: 6379 }),
});
```

On the server side, `redisPublisher` and `redisTimerPriorityQueue` plug into the runtime for push delivery and sub-second timers.

## Documentation

See the [Subscribers](https://aiki.run/docs/architecture/subscribers) architecture guide.

## License

Apache-2.0
