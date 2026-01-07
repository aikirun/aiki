# @aikirun/client

Client SDK for Aiki durable execution platform - connect to the Aiki server, start workflows, and manage execution.

## Installation

```bash
npm install @aikirun/client
```

## Quick Start

### Initialize the Client

```typescript
import { client } from "@aikirun/client";

const aikiClient = await client({
	url: "http://localhost:9876",
	redis: {
		host: "localhost",
		port: 6379,
	},
});
```

### Start a Workflow

```typescript
import { onboardingWorkflowV1 } from "./workflows.ts";

const stateHandle = await onboardingWorkflowV1.start(aikiClient, {
	email: "user@example.com",
});
```

### Wait for Workflow Completion

```typescript
const result = await stateHandle.wait(
	{ type: "status", status: "completed" },
	{ maxDurationMs: 60_000, pollIntervalMs: 5_000 },
);

if (result.success) {
	console.log("Workflow completed!");
} else {
	console.log("Workflow did not complete:", result.cause);
}
```

### Get Workflow State

```typescript
const state = await stateHandle.getState();
console.log("Current status:", state.status);
```

## Features

- **Reliable Connection** - HTTP client with automatic retry and connection pooling
- **Workflow Management** - Start workflows with type-safe inputs
- **State Polling** - Wait for workflow completion with configurable polling
- **Logger** - Built-in logging for debugging
- **Create Context** - Pass application context through workflow execution
- **Redis Integration** - Connect to Redis for distributed state management

## Configuration

### Client Parameters

```typescript
interface ClientParams<AppContext> {
	url: string; // Server URL
	redis: {
		host: string;
		port: number;
		password?: string;
		db?: number;
		maxRetriesPerRequest?: number;
		retryDelayOnFailoverMs?: number;
		connectTimeoutMs?: number;
	};
	createContext?: (run: WorkflowRun) => AppContext | Promise<AppContext>;
	logger?: Logger;
}
```

### Create Context Example

```typescript
const aikiClient = await client({
	url: "http://localhost:9876",
	redis: { host: "localhost", port: 6379 },
	createContext: (run) => ({
		traceId: generateTraceId(),
		workflowRunId: run.id,
		userId: extractUserIdFromRun(run),
	}),
});
```

## API Reference

See the [Aiki documentation](https://github.com/aikirun/aiki) for comprehensive API reference.

## Related Packages

- [@aikirun/workflow](https://www.npmjs.com/package/@aikirun/workflow) - Define workflows
- [@aikirun/task](https://www.npmjs.com/package/@aikirun/task) - Define tasks
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Execute workflows
- [@aikirun/types](https://www.npmjs.com/package/@aikirun/types) - Type definitions

## Changelog

See the [CHANGELOG](https://github.com/aikirun/aiki/blob/main/CHANGELOG.md) for version history.

## License

Apache-2.0
