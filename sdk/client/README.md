# @aikirun/client

Client SDK for Aiki durable execution platform.

## Installation

```bash
npm install @aikirun/client
```

## Quick Start

```typescript
import { client } from "@aikirun/client";
import { orderWorkflowV1 } from "./workflows.ts";

const aikiClient = client({
	url: "http://localhost:9850",
	redis: { host: "localhost", port: 6379 },
});

// Start a workflow
const handle = await orderWorkflowV1.start(aikiClient, {
	orderId: "order-123",
});

// Wait for completion
const result = await handle.waitForStatus("completed");

// Close when done
await aikiClient.close();
```

## Features

- **Server Connection** - Connect to the Aiki server via HTTP
- **Workflow Management** - Start workflows with type-safe inputs
- **Redis Integration** - Distributed state and message streaming
- **Context Injection** - Pass application context to workflows
- **Custom Logging** - Plug in your own logger

## Documentation

For comprehensive documentation including configuration options and context injection, see the [Client Guide](https://github.com/aikirun/aiki/blob/main/docs/core-concepts/client.md).

## Related Packages

- [@aikirun/workflow](https://www.npmjs.com/package/@aikirun/workflow) - Define workflows
- [@aikirun/task](https://www.npmjs.com/package/@aikirun/task) - Define tasks
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Execute workflows

## License

Apache-2.0
