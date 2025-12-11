# Client

The Aiki client provides the interface for starting workflows, monitoring execution, and retrieving results.

## Creating a Client

```typescript
import { client } from "@aikirun/client";

const aiki = await client({
	url: "localhost:9090",
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
url: "localhost:9090"; // Local development
// or
url: "https://aiki.example.com"; // Production
```

### redis

Redis connection configuration for the client:

```typescript
redis: {
  host: "localhost",
  port: 6379,
  password: "optional-password",  // Optional
  db: 0                           // Optional, default: 0
}
```

## Client Operations

### Starting Workflows

Use the workflow version's `.start()` method:

```typescript
const resultHandle = await workflowVersion.start(aiki, {
	payload: {
		userId: "123",
		email: "user@example.com",
	},
	idempotencyKey: "user-123-onboarding", // Optional
});
```

The `payload` parameter contains the input data for your workflow, while the optional `idempotencyKey` prevents
duplicate executions. The method returns a result handle that you can use for monitoring and retrieving results.

### Monitoring Workflow Runs

Check the status of a workflow run:

```typescript
const status = await resultHandle.getStatus();

console.log(status.id); // Workflow run ID
console.log(status.state); // pending, running, completed, failed, cancelled
console.log(status.result); // Result if completed
console.log(status.error); // Error if failed
```

### Waiting for Completion

Block until the workflow completes:

```typescript
const result = await resultHandle.waitForCompletion();
console.log("Workflow completed:", result);
```

This will wait indefinitely until the workflow finishes (successfully or with error).

### Cancelling Workflows

Cancel a running workflow:

```typescript
await resultHandle.cancel();
```

## Idempotency

Prevent duplicate workflow executions using idempotency keys:

```typescript
// First call - starts the workflow
const result1 = await workflowVersion.start(aiki, {
	payload: { orderId: "order-123" },
	idempotencyKey: "order-123-process",
});

// Second call with same key - returns existing workflow run
const result2 = await workflowVersion.start(aiki, {
	payload: { orderId: "order-123" },
	idempotencyKey: "order-123-process",
});

// result1.id === result2.id (same workflow run)
```

## Closing the Client

Always close the client when done to release resources:

```typescript
await aiki.close();
```

This closes the Redis connection and cleans up resources.

## Complete Example

```typescript
import { client } from "@aikirun/client";
import { task } from "@aikirun/task";
import { workflow } from "@aikirun/workflow";

// Define task and workflow
const sendEmail = task({
	id: "send-email",
	exec(input: { email: string }) {
		console.log(`Sending email to ${input.email}`);
		return { sent: true };
	},
});

const onboardingWorkflow = workflow({ id: "user-onboarding" });

const onboardingV1 = onboardingWorkflow.v("1.0.0", {
	async exec(input: { email: string }, run) {
		await sendEmail.start(run, { email: input.email });
		return { success: true };
	},
});

// Create client
const aiki = await client({
	url: "localhost:9090",
	redis: { host: "localhost", port: 6379 },
});

// Start workflow
const result = await onboardingV1
	.withOpts({ idempotencyKey: "user-onboarding-123" })
	.start(aiki, { email: "user@example.com" });

// Monitor progress
console.log("Workflow started:", result.id);

const status = await result.getStatus();
console.log("Current state:", status.state);

// Wait for completion
const finalResult = await result.waitForCompletion();
console.log("Completed:", finalResult);

// Clean up
await aiki.close();
```

## Error Handling

Handle errors when starting workflows:

```typescript
try {
	const result = await workflowVersion.start(aiki, {
		payload: { userId: "123" },
	});

	const finalResult = await result.waitForCompletion();
	console.log("Success:", finalResult);
} catch (error) {
	if (error.code === "WORKFLOW_NOT_FOUND") {
		console.error("Workflow doesn't exist");
	} else if (error.code === "VALIDATION_ERROR") {
		console.error("Invalid payload");
	} else {
		console.error("Unexpected error:", error);
	}
}
```

## API Access

The client provides direct API access for advanced use cases:

```typescript
// Low-level API access
const workflows = await aiki.api.listWorkflows();
const workflowRun = await aiki.api.getWorkflowRun(runId);
```

See the [Client API Reference](../api/client.md) for complete API documentation.

## Best Practices

1. **Reuse clients** - Create one client and reuse it across your application
2. **Use idempotency keys** - Prevent duplicate workflow executions
3. **Close clients** - Always close clients to release resources
4. **Set timeouts** - Use timeouts when waiting for completion

## Next Steps

- **[Workflows](./workflows.md)** - Learn about workflow definition
- **[Tasks](./tasks.md)** - Understand task execution
- **[Client API Reference](../api/client.md)** - Complete API documentation
- **[Idempotency](../guides/idempotency.md)** - Deep dive into idempotency keys
