# Client

The Aiki client is the typed connection to the server. Workers, schedules, and your application code all attach to it — to start workflows, send events, and inspect runs.

## Creating a Client

Two transports are supported. **Remote** connects to a server over HTTP:

```typescript
import { client } from "@aikirun/client";

const aikiClient = client({
	url: "http://localhost:9850",
});
```

**Embedded** invokes an in-process server's handler directly — no network hop:

```typescript
const aikiServer = server({ db: database({ provider: "pg", url: databaseUrl }) });

const aikiClient = client({ handler: aikiServer.handler });
```

Switching transports is a config-only change; workers and workflow code are unaffected.

## Configuration Options

### url (remote)

The URL of the Aiki server:

```typescript
url: "http://localhost:9850"; // Local development
```

### apiKey (remote)

API key for authentication — required when the server has IAM enabled. Create one from the dashboard UI:

```typescript
apiKey: "your-api-key"
```

### handler (embedded)

The in-process server's request handler:

```typescript
handler: aikiServer.handler
```

### context

Optional function to create per-execution context for workflows. Called before each workflow execution:

```typescript
const aikiClient = client<Context>({
	url: "http://localhost:9850",
	context: (run) => ({
		traceId: crypto.randomUUID(),
		workflowRunId: run.id,
	}),
});
```

See the [Dependency Injection Guide](../guides/dependency-injection.md) for more on `context` vs higher-order functions.

### logger

Optional custom logger implementation. Defaults to console logging:

```typescript
const aikiClient = client({
	url: "http://localhost:9850",
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

## Next Steps

- **[Workflows](./workflows.md)** - Learn about workflow definition and handles
- **[Tasks](./tasks.md)** - Understand task execution
- **[Reference IDs](../guides/reference-ids.md)** - Deep dive into reference IDs
