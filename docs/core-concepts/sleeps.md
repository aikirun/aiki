# Sleeps

Sleeps pause workflow execution for a specified duration. Unlike regular `setTimeout`, Aiki sleeps are durable - they survive worker restarts, deployments, and even server reboots.

## Using Sleeps

Call `run.sleep()` with a name and duration:

```typescript
const orderWorkflowV1 = orderWorkflow.v("1.0.0", {
	async handler(run, input) {
		await processOrder.start(run, input);

		// Wait 24 hours before sending follow-up
		await run.sleep("wait-for-followup", { hours: 24 });

		await sendFollowUpEmail.start(run, { orderId: input.orderId });
	},
});
```

### Duration Formats

Durations can be specified as an object or milliseconds:

```typescript
// Object format (recommended for readability)
await run.sleep("reminder", { days: 7 });
await run.sleep("cooldown", { hours: 1, minutes: 30 });
await run.sleep("delay", { seconds: 30 });

// Milliseconds
await run.sleep("short-delay", 5000);
```

Available fields: `days`, `hours`, `minutes`, `seconds`, `milliseconds`.

## How Sleeps Work

When a workflow calls `run.sleep()`:

1. The workflow suspends and releases the worker
2. The server records the sleep with its wake time
3. When the duration elapses, the server reschedules the workflow for execution

This means sleeping workflows don't consume worker resources. You can have thousands of workflows sleeping for days without impacting system capacity.

## Waking Early

You can wake a sleeping workflow before its duration elapses using the handle:

```typescript
// From outside the workflow
await handle.awake();
```

Inside the workflow, check if the sleep was cancelled:

```typescript
const result = await run.sleep("wait-for-payment", { hours: 48 });

if (result.cancelled) {
	// Woken early - payment received
	await processPayment.start(run, input);
} else {
	// Full duration elapsed - payment timeout
	await cancelOrder.start(run, input);
}
```

## Sleep Names

Sleeps require names so Aiki can identify them during replay. When a workflow resumes after sleeping, it replays from the beginning - the name tells Aiki which sleep already completed.

```typescript
// Different conceptual sleeps need different names
await run.sleep("initial-delay", { minutes: 5 });
await run.sleep("cooldown-period", { hours: 1 });
```

You can use the same name multiple times (like in a loop). Aiki tracks each call in sequence:

```typescript
// This loop sleeps 3 times total (30 seconds each iteration, 90 seconds total)
for (let i = 0; i < 3; i++) {
	await run.sleep("retry-delay", { seconds: 30 }); // Sleeps 30s
	await retryOperation.start(run, input);          // Then retries
}
```

During replay, the 1st `"retry-delay"` call matches the 1st recorded sleep, the 2nd call matches the 2nd recorded sleep, and so on. This ensures the workflow resumes at the correct loop iteration.

## Next Steps

- **[Workflows](./workflows.md)** - Workflow orchestration
- **[Refactoring Workflows](../guides/refactoring-workflows.md)** - How sleep duration changes are handled
