# @aikirun/endpoint

Execute Aiki workflows in serverless environments. The server pushes a signed HTTP request per ready run; the endpoint handler verifies the signature and executes the workflow.

## Installation

```bash
npm install @aikirun/endpoint
```

## Quick Start

```typescript
import { client } from "@aikirun/client";
import { endpoint } from "@aikirun/endpoint";
import { orderWorkflowV1 } from "./workflows.ts";

// A Fetch-compatible (Request) => Promise<Response> handler —
// mount it in any HTTP runtime
const handler = endpoint({
	client: client({ url: "http://localhost:9850", apiKey: "your-api-key" }),
	workflows: [orderWorkflowV1],
	secret: "shared-signing-secret",
});
```

## Documentation

See the [Architecture Overview](https://aiki.run/docs/architecture/overview) for how endpoints fit into work delivery.

## License

Apache-2.0
