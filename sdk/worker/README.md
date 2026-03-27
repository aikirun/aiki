# @aikirun/worker

Worker SDK for Aiki durable execution platform.

## Installation

```bash
npm install @aikirun/worker
```

## Quick Start

```typescript
import { worker } from "@aikirun/worker";
import { client } from "@aikirun/client";
import { orderWorkflowV1 } from "./workflows.ts";

const aikiClient = client({
	url: "http://localhost:9850",
	apiKey: "your-api-key",
});

const aikiWorker = worker({
	workflows: [orderWorkflowV1],
});

const handle = await aikiWorker.spawn(aikiClient);

// Graceful shutdown
process.on("SIGTERM", async () => {
	await handle.stop();
	process.exit(0);
});
```

## Features

- **Horizontal Scaling** - Run multiple workers to share workload
- **Automatic Recovery** - Resume from failures without losing progress
- **Heartbeat Monitoring** - Detect and recover stuck workflows
- **Graceful Shutdown** - Complete active work before stopping
- **Sharding** - Route workflows to specific workers
- **Pluggable Subscribers** - Swap work discovery transport (DB polling default, Redis Streams via `@aikirun/subscriber-redis`, or bring your own)

## Documentation

For comprehensive documentation including scaling strategies, configuration options, and how workers operate, see the [Workers Guide](https://github.com/aikirun/aiki/blob/main/docs/core-concepts/workers.md).

## Related Packages

- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Connect to Aiki server
- [@aikirun/workflow](https://www.npmjs.com/package/@aikirun/workflow) - Define workflows and tasks

## License

Apache-2.0
