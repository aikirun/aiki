# @aikirun/workflow

Workflow SDK for Aiki durable execution platform - define durable workflows with tasks, sleeps, waits, and event handling.

## Installation

```bash
npm install @aikirun/workflow
```

## Quick Start

### Define a Workflow

```typescript
import { workflow } from "@aikirun/workflow";
import { markUserVerified, sendVerificationEmail } from "./tasks.ts";

export const onboardingWorkflow = workflow({ id: "user-onboarding" });

export const onboardingWorkflowV1 = onboardingWorkflow.v("1.0.0", {
	async handler(run, input: { email: string }) {
		run.logger.info("Starting onboarding", { email: input.email });

		// Execute a task to send verification email
		await sendVerificationEmail.start(run, { email: input.email });

		// Execute task to mark user as verified
		// (In a real scenario, this would be triggered by an external event)
		await markUserVerified.start(run, { email: input.email });

		// Sleep for 24 hours before sending tips
		await run.sleep("onboarding-delay", { days: 1 });

		// Send usage tips
		await sendUsageTips.start(run, { email: input.email });

		return { success: true, userId: input.email };
	},
});
```

## Features

- **Durable Execution** - Automatically survives crashes and restarts
- **Task Orchestration** - Coordinate multiple tasks in sequence
- **Durable Sleep** - Sleep without consuming resources or blocking workers
- **State Snapshots** - Automatically save state at each step
- **Error Handling** - Built-in retry and recovery mechanisms
- **Multiple Versions** - Run different workflow versions simultaneously
- **Logging** - Built-in structured logging for debugging

## Workflow Primitives

### Execute Tasks

```typescript
const result = await createUserProfile.start(run, {
	email: input.email,
});
```

### Sleep for a Duration

```typescript
// Sleep requires a unique id for memoization
await run.sleep("daily-delay", { days: 1 });
await run.sleep("processing-delay", { hours: 2, minutes: 30 });
await run.sleep("short-pause", { seconds: 30 });
```

### Sleep Cancellation

Sleeps can be cancelled externally via the `wake()` method:

```typescript
const handle = await myWorkflow.start(client, input);
await handle.wake(); // Wakes the workflow if sleeping
```

The sleep returns a result indicating whether it was cancelled:

```typescript
const { cancelled } = await run.sleep("wait-period", { hours: 1 });
if (cancelled) {
  // Handle early wake-up
}
```

### Get Workflow State

```typescript
const { state } = await run.handle.getState();
console.log("Workflow status:", state.status);
```

### Logging

```typescript
run.logger.info("Processing user", { email: input.email });
run.logger.debug("User created", { userId: result.userId });
```

## Workflow Options

### Delayed Trigger

```typescript
export const morningWorkflowV1 = morningWorkflow.v("1.0.0", {
	// ... workflow definition
	opts: {
		trigger: {
			type: "delayed",
			delay: { seconds: 5 }, // or: delay: 5000
		},
	},
});
```

### Retry Strategy

```typescript
export const paymentWorkflowV1 = paymentWorkflow.v("1.0.0", {
	// ... workflow definition
	opts: {
		retry: {
			type: "exponential",
			maxAttempts: 3,
			baseDelayMs: 1000,
			maxDelayMs: 10000,
		},
	},
});
```

### Reference ID

```typescript
// Assign a reference ID for tracking and lookup
const handle = await orderWorkflowV1
	.with().opt("reference.id", `order-${orderId}`)
	.start(client, { orderId });

// Configure conflict handling: "error" (default) or "return_existing"
const handle = await orderWorkflowV1
	.with().opt("reference", { id: `order-${orderId}`, onConflict: "return_existing" })
	.start(client, { orderId });
```

## Running Workflows

With the client:

```typescript
import { client } from "@aikirun/client";
import { onboardingWorkflowV1 } from "./workflows.ts";

const aikiClient = await client({
	url: "http://localhost:9876",
	redis: { host: "localhost", port: 6379 },
});

const handle = await onboardingWorkflowV1.start(aikiClient, {
	email: "user@example.com",
});

// Wait for completion
const result = await handle.wait(
	{ type: "status", status: "completed" },
	{ maxDurationMs: 60 * 1000, pollIntervalMs: 5_000 },
);

if (result.success) {
	console.log("Workflow completed!", result.state);
} else {
	console.log("Workflow did not complete:", result.cause);
}
```

With a worker:

```typescript
import { worker } from "@aikirun/worker";

const aikiWorker = worker({
	id: "my-worker",
	workflows: [onboardingWorkflowV1],
	opts: {
		maxConcurrentWorkflowRuns: 10,
	},
});

await aikiWorker.spawn(aikiClient);
```

## Execution Context

The `run` parameter provides access to:

```typescript
interface WorkflowRunContext<Input, Output> {
	id: WorkflowRunId; // Unique run ID
	name: WorkflowName; // Workflow name
	versionId: WorkflowVersionId; // Version ID
	options: WorkflowOptions; // Execution options (trigger, retry, reference)
	handle: WorkflowRunHandle<Input, Output>; // Advanced state management
	logger: Logger; // Logging (info, debug, warn, error, trace)
	sleep(params: SleepParams): Promise<SleepResult>; // Durable sleep
}
```

Sleep parameters:
- `id` (required): Unique identifier for memoization
- Duration fields: `days`, `hours`, `minutes`, `seconds`, `milliseconds`

Example: `run.sleep("my-sleep", { days: 1, hours: 2 })`

## Error Handling

Workflows handle errors gracefully:

```typescript
try {
	await risky.start(run, input);
} catch (error) {
	run.logger.error("Task failed", { error: error.message });
	// Workflow can decide how to proceed
}
```

Failed workflows transition to `awaiting_retry` state and are automatically retried by the server.

### Expected Errors

`WorkflowRunSuspendedError` is thrown when a workflow suspends (e.g., during sleep).
This is expected behavior - the worker catches this error and the workflow resumes
when the sleep completes. Do not catch this error in workflow code.

## Best Practices

1. **Keep Workflows Deterministic** - Same input should always produce same output
2. **Expect Replays** - Code may execute multiple times during retries
3. **Use Descriptive Events** - Name events clearly for debugging
4. **Handle Timeouts** - Always check `event.received` after waiting
5. **Log Strategically** - Use logger to track workflow progress
6. **Version Your Workflows** - Deploy new versions alongside old ones

## Related Packages

- [@aikirun/task](https://www.npmjs.com/package/@aikirun/task) - Define tasks
- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Start workflows
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Execute workflows
- [@aikirun/types](https://www.npmjs.com/package/@aikirun/types) - Type definitions

## Changelog

See the [CHANGELOG](https://github.com/aikirun/aiki/blob/main/CHANGELOG.md) for version history.

## License

Apache-2.0
