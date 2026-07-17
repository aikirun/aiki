# @aikirun/worker

Long-lived processes that claim ready runs from the Aiki server and execute workflow code in your infrastructure.

## Installation

```bash
npm install @aikirun/worker
```

## Quick Start

```typescript
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";
import { orderWorkflowV1 } from "./workflows.ts";

const aikiClient = client({
	url: "http://localhost:9850",
	apiKey: "your-api-key",
});

const handle = worker({ workflows: [orderWorkflowV1] }).start(aikiClient);

process.on("SIGTERM", async () => {
	await handle.stop();
	process.exit(0);
});
```

## Documentation

See the [Workers Guide](https://aiki.run/docs/core-concepts/workers).

## License

Apache-2.0
