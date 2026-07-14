# @aikirun/client

Typed connection to the Aiki server — start workflows, send events, and observe runs from your application.

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
	apiKey: "your-api-key",
});

const handle = await orderWorkflowV1.start(aikiClient, {
	orderId: "order-123",
});

const result = await handle.waitForStatus("completed");
```

## Documentation

See the [Client Guide](https://aiki.run/docs/core-concepts/client).

## License

Apache-2.0
