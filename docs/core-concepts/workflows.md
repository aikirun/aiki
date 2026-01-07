# Workflows

A workflow is a recipe for a business process - it defines the steps needed to complete an operation. Workflows in Aiki are durable, versioned, and can contain complex logic.

## Defining a Workflow

Workflows are created in two steps:

1. **Create the workflow definition** with a name
2. **Add versions** with implementation logic

```typescript
import { workflow } from "@aikirun/workflow";

// Step 1: Create workflow definition
const orderWorkflow = workflow({
	name: "order-processing",
});

// Step 2: Create a version
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input: { orderId: string; amount: number }) {
		// Your workflow logic here
		const validation = await validateOrder.start(run, input);
		const payment = await processPayment.start(run, {
			orderId: validation.orderId,
			amount: input.amount,
		});

		return { success: true, orderId: validation.orderId };
	},
});
```

## Workflow Versioning

Versioning allows safe updates to workflows without breaking existing runs.

```typescript
const userOnboardingWorkflow = workflow({
	name: "user-onboarding",
});

// Version 1.0.0: Simple onboarding
const userOnboardingV1 = userOnboardingWorkflow.v("1.0.0", {
	async handler(run, input: { userId: string }) {
		await sendWelcomeEmail.start(run, {
			userId: input.userId,
		});
	},
});

// Version 2.0.0: Add profile creation
const userOnboardingV2 = userOnboardingWorkflow.v("2.0.0", {
	async handler(run, input: { userId: string }) {
		await sendWelcomeEmail.start(run, {
			userId: input.userId,
		});

		await createUserProfile.start(run, {
			userId: input.userId,
		});
	},
});
```

## Workflow Retry

Configure automatic retries for failed workflows using the `opts.retry` property:

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input: { orderId: string }) {
		// Workflow logic...
	},
	opts: {
		retry: {
			type: "exponential",
			maxAttempts: 3,
			baseDelayMs: 5000,
		},
	},
});
```

When a workflow fails (due to an unhandled error or task failure), Aiki will automatically retry it based on your retry strategy. Between retries, the workflow enters an `awaiting_retry` state.

For detailed guidance on retry strategies, see the **[Retry Strategies Guide](../guides/retry-strategies.md)**.

## Schema Validation

Define schemas to validate workflow input and output:

```typescript
import { z } from "zod";

const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input: { orderId: string; items: string[] }) {
		// ...
		return { success: true, total: 100 };
	},
	schema: {
		input: z.object({
			orderId: z.string(),
			items: z.array(z.string()),
		}),
		output: z.object({
			success: z.boolean(),
			total: z.number(),
		}),
	},
});
```

Schemas use any validation library with a `parse(data: unknown) => T` method (Zod, ArkType, etc.).

**Why use output schemas?** For child workflows, cached outputs are validated against the schema. If the cached shape doesn't match, the parent workflow fails immediately. See [Refactoring Workflows](../guides/refactoring-workflows.md#changing-task-or-child-workflow-output-shapes).

## Sharding

Route workflows to specific shards for distributed processing, multi-region deployments, or tenant isolation:

```typescript
const handle = await orderWorkflowV1
	.with()
	.opt("shard", "us-east")
	.start(client, { orderId: "123" });
```

Workers must be configured to listen to the same shard. A workflow routed to `"us-east"` will only be picked up by workers with `shards: ["us-east"]` in their configuration. See **[Workers](./workers.md)** for worker-side setup.

## Starting Workflows

Execute workflows using the version's `.start()` method:

```typescript
const handle = await workflowVersion.start(client, {
	userId: "123",
	email: "user@example.com",
});

// Access run data
console.log("Started:", handle.run.id);
console.log("Status:", handle.run.state.status);

// Wait for completion
const result = await handle.waitForStatus("completed");
if (result.success) {
	console.log("Output:", result.state.output);
} else {
	console.log("Failed:", result.cause);
}
```

## Workflow Runs

A workflow run is an instance of a workflow execution. It has:

### States

- `scheduled` - Scheduled for future execution
- `queued` - Queued, waiting to be picked up by a worker
- `running` - Currently executing
- `paused` - Paused by user
- `sleeping` - Waiting for a sleep duration to elapse
- `awaiting_event` - Waiting for an external event
- `awaiting_retry` - Waiting to retry after failure
- `awaiting_child_workflow` - Waiting for a child workflow to complete
- `completed` - Finished successfully
- `failed` - Encountered a non-retryable error or exhausted all retries
- `cancelled` - Cancelled by user

### Workflow Handle

A handle is a reference to a workflow run that lets you interact with it from outside the workflow - check its status, wait for completion, send events, or control execution.

The handle returned from `.start()` provides:

| Property/Method | Description |
|-----------------|-------------|
| `run` | The workflow run data (id, state, input, output, etc.) |
| `events` | Send events to the workflow |
| `refresh()` | Refresh run data from the server |
| `waitForStatus(status)` | Wait for a terminal status (`completed`, `failed`, `cancelled`) |
| `cancel(reason?)` | Cancel the workflow run |
| `pause()` | Pause the workflow |
| `resume()` | Resume a paused workflow |
| `awake()` | Wake a sleeping workflow |

#### Waiting for Status

The `waitForStatus()` method returns a result object:

```typescript
const result = await handle.waitForStatus("completed");

if (result.success) {
	// Workflow reached the requested status
	console.log("Output:", result.state.output);
} else {
	// Workflow reached a different terminal status
	console.log("Ended with:", result.cause);
}
```

#### Controlling Workflow Execution

```typescript
// Pause a running workflow
await handle.pause();

// Resume a paused workflow
await handle.resume();

// Cancel a workflow
await handle.cancel("User requested cancellation");
```

## Child Workflows

Workflows can start other workflows as children. By default, child workflows run in a fire-and-forget manner - the parent continues without waiting.

### Starting a Child Workflow

```typescript
const parentWorkflowV1 = parentWorkflow.v("1.0.0", {
	async handler(run, input) {
		// Fire and forget - parent continues immediately
		await childWorkflowV1.startAsChild(run, { userId: input.userId });

		// Parent continues without waiting for child
		await doOtherWork.start(run, input);
	},
});
```

### Waiting for Child Completion

To wait for a child workflow to complete, call `waitForStatus()` on the child handle:

```typescript
const parentWorkflowV1 = parentWorkflow.v("1.0.0", {
	async handler(run, input) {
		const childHandle = await childWorkflowV1.startAsChild(run, { userId: input.userId });

		// Parent suspends until child completes
		const result = await childHandle.waitForStatus("completed");

		if (result.success) {
			return { childOutput: result.state.output };
		} else {
			throw new Error(`Child failed: ${result.cause}`);
		}
	},
});
```

You can also wait with a timeout:

```typescript
const result = await childHandle.waitForStatus("completed", {
	timeout: { hours: 1 },
});

if (result.timeout) {
	// Child didn't complete within 1 hour
}
```

Like sleeps and events, child workflow waits have an internal queue. On replay, if the parent already waited for a child to complete, the cached result is returned immediately instead of waiting again.

### Reference IDs for Child Workflows

Use reference IDs to ensure idempotent child workflow creation:

```typescript
const childHandle = await childWorkflowV1
	.with()
	.opt("reference.id", `process-user-${input.userId}`)
	.startAsChild(run, { userId: input.userId });
```

Without a reference ID, child workflows are deduplicated by input hash.

### Conflict Policies

When starting a child workflow multiple times with the same reference ID but different inputs, Aiki provides two conflict policies:

```typescript
// Default: "error" - fails the parent workflow
const childHandle = await childWorkflowV1
	.with()
	.opt("reference.id", "unique-id")
	.startAsChild(run, input);

// Alternative: "return_existing" - returns the existing child run
const childHandle = await childWorkflowV1
	.with()
	.opt("reference", { id: "unique-id", onConflict: "return_existing" })
	.startAsChild(run, input);
```

| Policy | Behavior |
|--------|----------|
| `"error"` (default) | Fails the parent workflow if reference ID exists with different inputs |
| `"return_existing"` | Returns the existing child workflow run |

## Next Steps

- **[Tasks](./tasks.md)** - Learn about task execution
- **[Workers](./workers.md)** - Understand worker configuration
- **[Determinism](../guides/determinism.md)** - Write reliable workflows
