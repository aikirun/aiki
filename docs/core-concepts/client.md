# Client

The Aiki client connects to the server and lets you start workflows.

## Creating a Client

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

## Configuration Options

### url

The URL of the Aiki server:

```typescript
url: "http://localhost:9876"; // Local development
```

### redis

Redis connection configuration:

```typescript
redis: {
  host: "localhost",
  port: 6379,
  password: "optional-password",  // Optional
  db: 0                           // Optional, default: 0
}
```

### createContext

Optional function to create per-execution context for workflows. Called before each workflow execution:

```typescript
const aikiClient = await client<AppContext>({
	url: "http://localhost:9876",
	redis: { host: "localhost", port: 6379 },
	createContext: (run) => ({
		traceId: crypto.randomUUID(),
		workflowRunId: run.id,
	}),
});
```

See the [Dependency Injection Guide](../guides/dependency-injection.md) for more on `createContext` vs higher-order functions.

### logger

Optional custom logger implementation. Defaults to console logging:

```typescript
const aikiClient = await client({
	url: "http://localhost:9876",
	redis: { host: "localhost", port: 6379 },
	logger: myCustomLogger, // Must implement Logger interface
});
```

## Starting Workflows

Use the workflow version's `.start()` method:

```typescript
const handle = await workflowVersion.start(aikiClient, {
	userId: "123",
	email: "user@example.com",
});

console.log("Started workflow:", handle.run.id);
```

The method returns a handle for monitoring and controlling the workflow. See [Workflows](./workflows.md) for handle methods.

### With Reference ID

Prevent duplicate executions using a reference ID:

```typescript
const handle = await workflowVersion
	.with()
	.opt("reference.id", "order-123")
	.start(aikiClient, { orderId: "order-123" });
```

See the [Reference IDs Guide](../guides/reference-ids.md) for more details.

## Closing the Client

Always close the client when done to release resources:

```typescript
await aikiClient.close();
```

## Next Steps

- **[Workflows](./workflows.md)** - Learn about workflow definition and handles
- **[Tasks](./tasks.md)** - Understand task execution
- **[Reference IDs](../guides/reference-ids.md)** - Deep dive into reference IDs
